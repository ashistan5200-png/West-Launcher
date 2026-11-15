//! Ashi sohbet asistanı. Üç sağlayıcı:
//!   - Ollama (varsayılan): kullanıcının bilgisayarında çalışan ücretsiz yerel model
//!   - Claude Haiku 5.5: kullanıcının kendi anahtarıyla, düşük token ayarlarıyla
//!   - Kapalı: yapay zekasız anahtar kelime araması
//! Claude ham HTTP ile çağrılır (Rust için resmi Anthropic SDK'sı yok; anahtar webview'a girmez).
//!
//! Araçlar:
//!   - search_content          → birleşik Modrinth + CurseForge araması
//!   - list_instances          → kullanıcının instance'ları (sürüm/loader uyumu için)
//!   - present_recommendations → seçilen sonuçları UI'da kurulabilir kart olarak göster
//!
//! Anahtar yoksa `keyword_assist` aynı arama motoruyla basit bir yanıt üretir.


pub mod ollama;

use crate::content::{self, ContentHit, Kind, SearchQuery, Source};
use crate::core::http::Http;
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2026-10-21";
/// Maliyet için en ucuz güncel model (Opus 5.5'e göre girişte de çıkışta da 40 kat ucuz)
const MODEL: &str = "claude-haiku-5-5";
/// Token tasarrufu: en fazla 4 araç turu, kısa yanıt, düşük efor
pub(crate) const MAX_TOOL_ROUNDS: usize = 4;
const MAX_TOKENS: u32 = 2048;
pub(crate) const SEARCH_LIMIT: u32 = 8;

/// Sabit sistem istemi — önbelleğe alınabilmesi için değişken bilgi içermez;
/// aktif instance gibi bağlam kullanıcı mesajına eklenir.
pub(crate) const SYSTEM: &str = "Sen Ashi'sin: West Client adlı Minecraft launcher'ının içindeki yardımcı. \
Meraklı, sakin ve samimi bir iz sürücüsün; kısa ve net konuşursun. Kullanıcı hangi dilde yazarsa o dilde cevap ver (çoğunlukla Türkçe).\n\n\
Görevin: kullanıcının isteğine uygun mod, modpack, shader ve resource pack bulmak.\n\
- Önerdiğin her içeriği search_content ile bulmuş olmalısın; aramada çıkmayan bir projeyi asla önerme ya da uydurma.\n\
- İstek belirsizse önce makul aramalar yap; gerekirse farklı anahtar kelimelerle (İngilizce terimler daha iyi sonuç verir) birkaç arama yap.\n\
- Mod önerirken kullanıcının instance'ının Minecraft sürümü ve loader'ı ile uyumlu sonuçları tercih et. Bağlamda aktif instance verilmişse onu kullan; \
verilmemişse ve sürüm önemliyse list_instances ile bak.\n\
- Sonunda en uygun 3–6 sonucu present_recommendations ile sun; her biri için tek cümlelik, somut bir gerekçe yaz.\n\
- Yanıt metnin 2–4 cümleyi geçmesin; kartlar ayrıntıyı gösterir. Kurulumu kullanıcı kartlardaki düğmeyle yapar, sen yapmazsın.\n\
- Minecraft dışı konularda kibarca Minecraft'a geri dön. Hile/sunucu kurallarını çiğneyen istemciler (ör. PvP sunucularında yasak hile modları) önerme; \
performans, görsel ve oynanış modları önerebilirsin.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceBrief {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub hit: ContentHit,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutcome {
    /// Ham API mesaj geçmişi — UI bunu olduğu gibi saklar ve sonraki turda geri yollar
    /// (thinking/fallback blokları değiştirilmeden korunmalı).
    pub history: Vec<Value>,
    pub reply: String,
    pub picks: Vec<Pick>,
    pub searches: Vec<String>,
    /// "claude" | "keyword"
    /// "ollama" | "claude" | "keyword"
    pub mode: &'static str,
}

/// Kullanıcının seçtiği yapay zeka sağlayıcısı.
#[derive(Debug, Clone)]
pub enum Provider {
    Ollama { url: String, model: String },
    Claude { key: String },
    Off,
}

pub struct Ctx<'a> {
    pub http: &'a Http,
    pub provider: Provider,
    pub cf_key: Option<&'a str>,
    pub instances: Vec<InstanceBrief>,
    pub active: Option<InstanceBrief>,
}

fn tools() -> Value {
    json!([
        {
            "name": "search_content",
            "description": "Modrinth ve CurseForge'da aynı anda Minecraft içeriği arar. İngilizce anahtar kelimeler en iyi sonucu verir (ör. 'horror', 'pvp', 'performance', 'minimap'). Sonuçlar indirme sayısı, açıklama ve kategorilerle döner.",
            "strict": true,
            "input_schema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["query", "kind", "game_version", "loader"],
                "properties": {
                    "query": { "type": "string", "description": "Arama terimleri; boş bırakılırsa popüler içerik döner" },
                    "kind": { "type": "string", "enum": ["mod", "modpack", "shader", "resourcepack"] },
                    "game_version": { "type": ["string", "null"], "description": "Örn. 1.21.1; bilinmiyorsa null" },
                    "loader": { "type": ["string", "null"], "enum": ["fabric", "quilt", "forge", "neoforge", null], "description": "Mod/modpack için loader; bilinmiyorsa null" }
                }
            }
        },
        {
            "name": "list_instances",
            "description": "Kullanıcının West Client'daki instance'larını (ad, Minecraft sürümü, loader) listeler.",
            "strict": true,
            "input_schema": { "type": "object", "additionalProperties": false, "properties": {}, "required": [] }
        },
        {
            "name": "present_recommendations",
            "description": "Seçtiğin sonuçları kullanıcıya tek tıkla kurulabilir kartlar olarak gösterir. Yalnızca bu sohbette search_content'in döndürdüğü sonuçları kullan.",
            "strict": true,
            "input_schema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["items"],
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["source", "id", "reason"],
                            "properties": {
                                "source": { "type": "string", "enum": ["modrinth", "curseforge"] },
                                "id": { "type": "string" },
                                "reason": { "type": "string", "description": "Neden uygun olduğuna dair tek, somut cümle" }
                            }
                        }
                    }
                }
            }
        }
    ])
}

pub(crate) fn context_note(ctx: &Ctx<'_>) -> String {
    match &ctx.active {
        Some(i) => format!("[Bağlam] Kullanıcının şu an seçili instance'ı: \"{}\" — Minecraft {}, loader: {}.", i.name, i.mc_version, i.loader),
        None => "[Bağlam] Seçili bir instance yok.".into(),
    }
}

async fn call_api(http: &Http, key: &str, messages: &[Value]) -> Result<Value> {
    let body = json!({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": [{ "type": "text", "text": SYSTEM, "cache_control": { "type": "ephemeral" } }],
        "tools": tools(),
        "tool_choice": { "type": "auto" },
        // Düşük efor: daha az düşünme token'ı ve daha az araç çağrısı
        "output_config": { "effort": "low" },
        "messages": messages,
    });
    let mut last = None;
    for attempt in 0..3u32 {
        let resp = http
            .client
            .post(API_URL)
            .header("x-api-key", key)
            .header("anthropic-version", API_VERSION)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        if status.is_success() {
            return Ok(resp.json().await?);
        }
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or_else(|| text.chars().take(200).collect());
        let err = match status.as_u16() {
            401 => return Err(AppError::msg("Anthropic API anahtarı geçersiz. Ayarlar → Hesaplar ve anahtarlar bölümünden kontrol edin.")),
            403 => return Err(AppError::msg(format!("Anthropic API erişimi reddedildi: {msg}"))),
            400 | 404 | 413 => return Err(AppError::msg(format!("Ashi isteği gönderilemedi: {msg}"))),
            429 => AppError::msg("Ashi şu an çok yoğun (hız sınırı). Biraz sonra tekrar dene."),
            _ => AppError::msg(format!("Anthropic API hatası {status}: {msg}")),
        };
        // 429 / 5xx / 529 tekrar denenebilir
        last = Some(err);
        tokio::time::sleep(Duration::from_millis(800 * 2u64.pow(attempt))).await;
    }
    Err(last.unwrap())
}

/// Araç sonuçları modele kısa gönderilir (token tasarrufu).
fn compact(h: &ContentHit) -> Value {
    let desc: String = h.description.chars().take(110).collect();
    json!({
        "source": h.source, "id": h.id, "title": h.title,
        "description": desc, "downloads": h.downloads, "categories": h.categories.iter().take(2).collect::<Vec<_>>(),
    })
}

pub(crate) struct ToolState {
    pub seen: HashMap<(Source, String), ContentHit>,
    pub picks: Vec<Pick>,
    pub searches: Vec<String>,
}

impl ToolState {
    pub fn new() -> Self {
        Self { seen: HashMap::new(), picks: vec![], searches: vec![] }
    }
}

pub(crate) async fn run_tool(ctx: &Ctx<'_>, st: &mut ToolState, name: &str, input: &Value) -> (String, bool) {
    match name {
        "search_content" => {
            let kind: Kind = serde_json::from_value(input["kind"].clone()).unwrap_or(Kind::Mod);
            let q = SearchQuery {
                query: input["query"].as_str().unwrap_or("").to_string(),
                kind: Some(kind),
                game_version: input["game_version"].as_str().map(String::from),
                loader: input["loader"].as_str().map(String::from),
                sort: None,
                limit: Some(SEARCH_LIMIT),
                offset: None,
                sources: None,
            };
            st.searches.push(q.query.clone());
            match content::search(ctx.http, ctx.cf_key, &q).await {
                Ok(r) => {
                    for h in &r.hits {
                        st.seen.insert((h.source, h.id.clone()), h.clone());
                    }
                    let out = json!({ "results": r.hits.iter().map(compact).collect::<Vec<_>>(), "notices": r.notices });
                    (out.to_string(), false)
                }
                Err(e) => (format!("Arama başarısız: {e}"), true),
            }
        }
        "list_instances" => (json!({ "instances": ctx.instances }).to_string(), false),
        "present_recommendations" => {
            let mut missing = Vec::new();
            for item in input["items"].as_array().cloned().unwrap_or_default() {
                let source: Option<Source> = serde_json::from_value(item["source"].clone()).ok();
                let id = item["id"].as_str().unwrap_or("").to_string();
                match source.and_then(|s| st.seen.get(&(s, id.clone()))) {
                    Some(hit) if !st.picks.iter().any(|p| p.hit.id == hit.id && p.hit.source == hit.source) => {
                        st.picks.push(Pick { hit: hit.clone(), reason: item["reason"].as_str().unwrap_or("").to_string() })
                    }
                    Some(_) => {}
                    None => missing.push(id),
                }
            }
            if missing.is_empty() {
                (format!("{} öneri kullanıcıya kart olarak gösterildi.", st.picks.len()), false)
            } else {
                (format!("Şu kimlikler bu sohbetteki arama sonuçlarında yok, gösterilmedi: {}. Önce search_content ile bul.", missing.join(", ")), true)
            }
        }
        other => (format!("Bilinmeyen araç: {other}"), true),
    }
}

/// Tek kullanıcı turu: seçilen sağlayıcıya yönlendirir. Yerel model çalışmıyorsa
/// sessizce anahtar kelime moduna düşer ve bunu yanıtta söyler.
pub async fn chat(ctx: &Ctx<'_>, history: Vec<Value>, user_text: &str) -> Result<ChatOutcome> {
    match &ctx.provider {
        Provider::Claude { key } => chat_claude(ctx, key, keep(history, |m| m["role"] != "tool"), user_text).await,
        Provider::Ollama { url, model } => match ollama::chat(ctx, url, model, keep(history, |m| m["content"].is_string() || m["role"] == "assistant"), user_text).await {
            Ok(out) => Ok(out),
            Err(e) => {
                let mut out = keyword_assist(ctx, vec![], user_text).await?;
                out.reply = format!("(Yerel model şu an kullanılamıyor: {e}. Basit aramayla yanıtlıyorum.)\n\n{}", out.reply);
                Ok(out)
            }
        },
        Provider::Off => keyword_assist(ctx, history, user_text).await,
    }
}

/// Sağlayıcı değiştiyse önceki geçmişin uyumsuz biçimli mesajlarını atar.
fn keep(history: Vec<Value>, f: impl Fn(&Value) -> bool) -> Vec<Value> {
    if history.iter().all(&f) { history } else { vec![] }
}

async fn chat_claude(ctx: &Ctx<'_>, key: &str, mut history: Vec<Value>, user_text: &str) -> Result<ChatOutcome> {
    history.push(json!({
        "role": "user",
        "content": [ { "type": "text", "text": context_note(ctx) }, { "type": "text", "text": user_text } ]
    }));

    let mut st = ToolState::new();
    let mut reply = String::new();

    for _round in 0..=MAX_TOOL_ROUNDS {
        let resp = call_api(ctx.http, key, &history).await?;
        let content = resp["content"].clone();
        // Yanıt içeriği (thinking ve fallback blokları dahil) değiştirilmeden geçmişe eklenir
        history.push(json!({ "role": "assistant", "content": content }));

        let blocks = content.as_array().cloned().unwrap_or_default();
        let text: String = blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n");

        match resp["stop_reason"].as_str() {
            Some("tool_use") => {
                // Paralel araç çağrılarının tüm sonuçları tek kullanıcı mesajında döner
                let mut results = Vec::new();
                for b in blocks.iter().filter(|b| b["type"] == "tool_use") {
                    let (out, is_error) = run_tool(ctx, &mut st, b["name"].as_str().unwrap_or(""), &b["input"]).await;
                    results.push(json!({ "type": "tool_result", "tool_use_id": b["id"], "content": out, "is_error": is_error }));
                }
                history.push(json!({ "role": "user", "content": results }));
                if !text.is_empty() {
                    reply = text;
                }
            }
            Some("refusal") => {
                reply = "Bu isteğe yardımcı olamıyorum. Minecraft modları, modpack'ler, shader'lar veya resource pack'lerle ilgili başka bir şey sorabilirsin.".into();
                break;
            }
            Some("max_tokens") => {
                reply = if text.is_empty() { "Cevabım çok uzadı, isteği biraz daraltır mısın?".into() } else { text };
                break;
            }
            _ => {
                reply = text;
                break;
            }
        }
    }
    if reply.trim().is_empty() {
        reply = if st.picks.is_empty() { "Uygun bir şey bulamadım; farklı kelimelerle tekrar dener misin?".into() } else { "İşte bulduklarım:".into() };
    }
    Ok(ChatOutcome { history, reply, picks: st.picks, searches: st.searches, mode: "claude" })
}

// ───────── Anahtarsız yedek mod ─────────

const TR_EN: &[(&str, &str)] = &[
    ("korku", "horror"), ("aksiyon", "combat"), ("macera", "adventure"), ("keşif", "exploration"), ("büyü", "magic"),
    ("teknoloji", "tech"), ("otomasyon", "automation"), ("optimizasyon", "optimization"), ("performans", "performance"),
    ("fps", "performance"), ("harita", "minimap"), ("gölge", "shaders"), ("gerçekçi", "realistic"), ("hayatta kalma", "survival"),
    ("inşa", "building"), ("dekorasyon", "decoration"), ("canavar", "mobs"), ("yaratık", "creatures"), ("ejderha", "dragons"),
    ("silah", "weapons"), ("zindan", "dungeons"), ("köy", "villages"), ("yemek", "food"), ("tarım", "farming"), ("hafif", "lightweight"),
];

const STOP: &[&str] = &[
    "bana", "bir", "iyi", "öner", "önerir", "misin", "mısın", "için", "ve", "ile", "en", "güzel", "lazım", "istiyorum", "bul",
    "mod", "modu", "modlar", "modları", "modpack", "modpacki", "modpack'i", "paket", "paketi", "shader", "shaderı", "shader'ı",
    "resource", "pack", "doku", "kaynak", "please", "recommend", "good", "some", "a", "the", "for",
];

pub fn parse_intent(text: &str) -> (Kind, String) {
    let lower = text.to_lowercase();
    let kind = if lower.contains("modpack") || lower.contains("paket öner") {
        Kind::Modpack
    } else if lower.contains("shader") || lower.contains("gölge") {
        Kind::Shader
    } else if lower.contains("resource") || lower.contains("doku") || lower.contains("texture") {
        Kind::Resourcepack
    } else {
        Kind::Mod
    };
    let mut terms: Vec<String> = Vec::new();
    for (tr, en) in TR_EN {
        if lower.contains(tr) && !terms.iter().any(|t| t == en) {
            terms.push(en.to_string());
        }
    }
    for w in lower.split(|c: char| !c.is_alphanumeric() && c != '\'' && c != '-') {
        let w = w.trim_matches('\'');
        if w.len() > 2 && !STOP.contains(&w) && !TR_EN.iter().any(|(tr, _)| w.starts_with(tr) || tr.contains(w)) && w.is_ascii() && !terms.iter().any(|t| t == w) {
            terms.push(w.to_string());
        }
    }
    (kind, terms.join(" "))
}

async fn keyword_assist(ctx: &Ctx<'_>, history: Vec<Value>, text: &str) -> Result<ChatOutcome> {
    let (kind, query) = parse_intent(text);
    let (gv, loader) = match (&ctx.active, kind) {
        (Some(i), Kind::Mod) => (Some(i.mc_version.clone()), (i.loader != "vanilla").then(|| i.loader.clone())),
        (Some(i), Kind::Shader | Kind::Resourcepack) => (Some(i.mc_version.clone()), None),
        _ => (None, None),
    };
    let q = SearchQuery { query: query.clone(), kind: Some(kind), game_version: gv, loader, sort: None, limit: Some(6), offset: None, sources: None };
    let r = content::search(ctx.http, ctx.cf_key, &q).await?;
    let picks: Vec<Pick> = r
        .hits
        .into_iter()
        .take(6)
        .map(|h| Pick { reason: format!("{} indirme · {}", fmt_count(h.downloads), h.categories.iter().take(2).cloned().collect::<Vec<_>>().join(", ")), hit: h })
        .collect();
    let reply = if picks.is_empty() {
        "Bu aramayla bir şey bulamadım. Farklı kelimeler dener misin?".to_string()
    } else {
        format!(
            "\"{}\" için en popüler sonuçlar bunlar. Daha akıllı öneriler için Ayarlar'dan ücretsiz yerel yapay zekayı (Ollama) açabilirsin.",
            if query.is_empty() { "popüler" } else { query.as_str() }
        )
    };
    Ok(ChatOutcome { history, reply, picks, searches: vec![query], mode: "keyword" })
}

fn fmt_count(n: u64) -> String {
    match n {
        0..=999 => n.to_string(),
        1_000..=999_999 => format!("{:.1}B", n as f64 / 1_000.0),
        _ => format!("{:.1}M", n as f64 / 1_000_000.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn intent_turkish() {
        let (k, q) = parse_intent("Bana iyi bir korku-aksiyon modpacki öner");
        assert_eq!(k, Kind::Modpack);
        assert!(q.contains("horror") && q.contains("combat"), "{q}");
        let (k, q) = parse_intent("PvP optimizasyonu için mod öner");
        assert_eq!(k, Kind::Mod);
        assert!(q.contains("pvp") && q.contains("optimization"), "{q}");
        assert_eq!(parse_intent("gerçekçi shader").0, Kind::Shader);
    }
    #[test]
    fn tool_schemas_are_strict_objects() {
        for t in tools().as_array().unwrap() {
            assert_eq!(t["strict"], true);
            assert_eq!(t["input_schema"]["additionalProperties"], false);
        }
    }
}
