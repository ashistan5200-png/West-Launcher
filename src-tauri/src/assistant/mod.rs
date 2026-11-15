//! Ashi sohbet asistanı. İki mod, ikisi de tamamen ücretsiz ve anahtarsız:
//!   - Ollama: kullanıcının bilgisayarında çalışan yerel model (tek tıkla kurulur)
//!   - Anahtar kelime: yapay zekasız; mesajdaki kelimeleri yakalayıp arar
//!
//! Araçlar:
//!   - search_content          → birleşik Modrinth + CurseForge araması
//!   - list_instances          → kullanıcının instance'ları (sürüm/loader uyumu için)
//!   - present_recommendations → seçilen sonuçları UI'da kurulabilir kart olarak göster
//!
//! Yerel model yoksa `keyword_assist` aynı arama motoruyla basit bir yanıt üretir.


pub mod ollama;
pub mod setup;

use crate::content::{self, ContentHit, Kind, SearchQuery, Source};
use crate::core::http::Http;
use crate::error::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

pub(crate) const MAX_TOOL_ROUNDS: usize = 4;
pub(crate) const SEARCH_LIMIT: u32 = 8;

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
    /// "ollama" | "keyword"
    pub mode: &'static str,
}

/// Kullanıcının seçtiği yapay zeka sağlayıcısı.
#[derive(Debug, Clone)]
pub enum Provider {
    Ollama { url: String, model: String },
    Off,
}

pub struct Ctx<'a> {
    pub http: &'a Http,
    pub provider: Provider,
    pub cf_key: Option<&'a str>,
    pub instances: Vec<InstanceBrief>,
    pub active: Option<InstanceBrief>,
}

pub(crate) fn context_note(ctx: &Ctx<'_>) -> String {
    match &ctx.active {
        Some(i) => format!("[Bağlam] Kullanıcının şu an seçili instance'ı: \"{}\" — Minecraft {}, loader: {}.", i.name, i.mc_version, i.loader),
        None => "[Bağlam] Seçili bir instance yok.".into(),
    }
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
                ..Default::default()
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
        Provider::Ollama { url, model } => match ollama::chat(ctx, url, model, keep(history, |m| m["content"].is_string() || m["role"] == "assistant"), user_text).await {
            Ok(out) => Ok(out),
            // Yerel model kurulu/açık değilse anahtar kelime moduyla sessizce devam et;
            // arayüz kurulumu ayrıca, kibarca önerir
            Err(_) => keyword_assist(ctx, vec![], user_text).await,
        },
        Provider::Off => keyword_assist(ctx, history, user_text).await,
    }
}

/// Sağlayıcı değiştiyse önceki geçmişin uyumsuz biçimli mesajlarını atar.
fn keep(history: Vec<Value>, f: impl Fn(&Value) -> bool) -> Vec<Value> {
    if history.iter().all(&f) { history } else { vec![] }
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
    let q = SearchQuery { query: query.clone(), kind: Some(kind), game_version: gv, loader, sort: None, limit: Some(6), offset: None, sources: None, ..Default::default() };
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
            "\"{}\" için en popüler sonuçlar bunlar.",
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
}
