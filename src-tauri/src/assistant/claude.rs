//! Ashi'nin Claude ile çalışan ajan modu (Anthropic Messages API, kullanıcının kendi API anahtarıyla).
//! Rust için resmi SDK olmadığından istekler doğrudan HTTP ile atılır. Döngü:
//! istek → yanıttaki `tool_use` bloklarını çalıştır → hepsinin `tool_result`'ını tek kullanıcı mesajında
//! geri yolla → `end_turn` gelene kadar sürdür. Asistan içeriği (düşünme blokları dahil) geçmişe olduğu gibi
//! eklenir; arayüz geçmişi opak saklayıp sonraki turda geri yollar.

use super::{context_note, run_tool, ChatOutcome, Ctx, ToolState};
use crate::error::{AppError, Result};
use serde_json::{json, Value};
use std::time::Duration;

pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
const API: &str = "https://api.anthropic.com/v1/messages";
const VERSION: &str = "2026-10-21";
/// Reddedilen (refusal) isteği sunucu tarafında uygun modelle yeniden çalıştırır
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
/// Bir turda en fazla bu kadar araç döngüsü (modpack kurulumu çok adımlıdır)
const MAX_ROUNDS: usize = 24;

const SYSTEM: &str = "Sen Ashi'sin: West Client adlı Minecraft launcher'ının içindeki yardımcı. Kullanıcıyla onun dilinde (çoğunlukla Türkçe) kısa, sıcak ve net konuşursun.

Neler yapabilirsin: içerik arar ve önerirsin; kullanıcı isterse işi kendin yaparsın: yeni instance (modpack) kurar, mod/shader/kaynak paketi ekler, modları açıp kapatır, FPS paketi kurar, bir sunucuya göre paket hazırlar, çökme raporunu okuyup sebebini bulursun.

Nasıl çalışırsın:
- Önce durumu öğren: list_instances ve gerekiyorsa list_installed. Kullanıcının seçili instance'ı mesajın başındaki [Bağlam] satırında yazar.
- İçerikleri search_content ile bul (İngilizce anahtar kelimeler). Yalnızca arama sonuçlarındaki projeleri kullan; asla kimlik uydurma.
- Modpack isteğinde: temaya uyan 8-20 mod seç, hepsinin ortak desteklediği Minecraft sürümünü ve yükleyiciyi belirle (çoğu modun desteklediği en yeni sürüm; çoğunlukla Fabric ya da NeoForge), create_instance ile kur, sonra her mod için install_content çağır. Çekirdek kütüphaneleri (Fabric API vb.) kurulum zaten ekler. Performans için sonunda fps_pack çağırabilirsin.
- Bir kurulum başarısız olursa sebebini oku, uygun bir alternatif ara ve dene; olmadıysa bildir.
- Büyük değişiklikten önce (yeni modpack, 5'ten fazla mod, var olan modları kapatma) planı birkaç maddeyle anlat ve onay iste. Kullanıcı açıkça \"kur\", \"yap\", \"hemen\" dediyse onay beklemeden yap.
- Oyun açıkken o instance'ta değişiklik yapılamaz; araç bunu söylerse kullanıcıya oyunu kapatmasını söyle.
- Bitince ne yaptığını kısaca özetle: hangi instance, kaç mod, atlananlar ve sebebi. Uzun listeleri tekrar yazma; değişiklikler arayüzde ayrıca listelenir.
- Öneri istendiğinde (kurulum değil) present_recommendations ile 3-5 kart göster.";

/// Testlerde sahte sunucuya yönlendirmek için (yalnızca hata ayıklama derlemesinde)
fn api_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(u) = std::env::var("WEST_ANTHROPIC_URL") {
        return u;
    }
    API.to_string()
}

fn tools() -> Value {
    Value::Array(super::actions::defs().into_iter().map(|(name, description, schema)| json!({ "name": name, "description": description, "input_schema": schema })).collect())
}

fn api_error(status: reqwest::StatusCode, body: &str) -> AppError {
    let v: Value = serde_json::from_str(body).unwrap_or_default();
    let msg = v["error"]["message"].as_str().unwrap_or(body).to_string();
    AppError::msg(match status.as_u16() {
        401 => crate::i18n::t("Anthropic API anahtarı geçersiz. Ayarlar → Ashi'den kontrol et."),
        403 => crate::i18n::t("Bu API anahtarının bu modele erişimi yok."),
        429 => crate::i18n::t("Çok fazla istek; birkaç saniye sonra tekrar dene."),
        529 | 500..=599 => crate::i18n::t("Claude şu an yoğun; biraz sonra tekrar dene."),
        _ => crate::i18n::tf("Claude isteği başarısız: {0}", &[&msg]),
    })
}

pub async fn chat(ctx: &Ctx<'_>, key: &str, model: &str, mut history: Vec<Value>, user_text: &str) -> Result<ChatOutcome> {
    history.push(json!({ "role": "user", "content": format!("{}\n\n{}", context_note(ctx), user_text) }));
    let mut st = ToolState::new();
    let mut reply = String::new();

    for _ in 0..MAX_ROUNDS {
        let body = json!({
            "model": model,
            "max_tokens": 16000,
            "system": SYSTEM,
            "tools": tools(),
            "messages": history,
            // Sohbet ve araç kullanımı için orta derinlik yeterli; düşünme bu modelde hep açık
            "output_config": { "effort": "medium" },
            "fallbacks": "default",
            // Sistem istemi ve araç listesi sabit: önbellekten okunur
            "cache_control": { "type": "ephemeral" },
        });
        let resp = ctx
            .http
            .client
            .post(api_url())
            .timeout(Duration::from_secs(300))
            .header("x-api-key", key)
            .header("anthropic-version", VERSION)
            .header("anthropic-beta", FALLBACK_BETA)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::msg(crate::i18n::tf("Claude'a ulaşılamadı: {0}", &[&e])))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(api_error(status, &text));
        }
        let msg: Value = serde_json::from_str(&text)?;
        let content = msg["content"].clone();
        let stop = msg["stop_reason"].as_str().unwrap_or("");
        // Asistan içeriği olduğu gibi geçmişe (düşünme blokları dahil; sıralı ve değiştirilmeden)
        history.push(json!({ "role": "assistant", "content": content }));

        if stop == "refusal" {
            reply = crate::i18n::t("Bu isteğe yardımcı olamıyorum.");
            break;
        }
        let blocks = content.as_array().cloned().unwrap_or_default();
        let calls: Vec<&Value> = blocks.iter().filter(|b| b["type"] == "tool_use").collect();
        if stop == "tool_use" && !calls.is_empty() {
            let mut results = Vec::new();
            for c in calls {
                let name = c["name"].as_str().unwrap_or("");
                let (out, is_error) = run_tool(ctx, &mut st, name, &c["input"]).await;
                results.push(json!({ "type": "tool_result", "tool_use_id": c["id"], "content": out, "is_error": is_error }));
            }
            // Bütün sonuçlar tek kullanıcı mesajında
            history.push(json!({ "role": "user", "content": results }));
            continue;
        }
        reply = blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n").trim().to_string();
        if stop == "max_tokens" && reply.is_empty() {
            reply = crate::i18n::t("Yanıt çok uzadı; isteği biraz daraltır mısın?");
        }
        break;
    }
    if reply.is_empty() {
        reply = if st.actions.is_empty() { crate::i18n::t("Bitti.") } else { crate::i18n::t("Tamamlandı.") };
    }
    Ok(ChatOutcome { history, reply, picks: st.picks, searches: st.searches, actions: st.actions, mode: "claude" })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assistant::{Ctx, Provider};

    /// Sahte Messages API'ye karşı tam döngü: araç çağrısı → sonuç tek kullanıcı mesajında → son yanıt.
    /// Sahte sunucu 127.0.0.1:8799'da elle başlatılır; yoksa test atlanır.
    #[tokio::test]
    #[ignore]
    async fn tool_loop_against_mock() {
        std::env::set_var("WEST_ANTHROPIC_URL", "http://127.0.0.1:8799/v1/messages");
        let root = std::env::temp_dir().join(format!("west-claude-{}", uuid::Uuid::new_v4()));
        let state = crate::state::AppState::new(crate::paths::Paths::new(root.clone()));
        let ctx = Ctx { http: &state.http, state: &state, provider: Provider::Off, cf_key: None, instances: vec![], active: None };
        let out = chat(&ctx, "test-key", DEFAULT_MODEL, vec![], "Hangi instance'larım var?").await.unwrap();
        assert_eq!(out.reply, "Bir instance'ın var: Test.");
        assert_eq!(out.mode, "claude");
        // user, assistant(tool_use), user(tool_result), assistant(text)
        assert_eq!(out.history.len(), 4);
        assert_eq!(out.history[2]["content"][0]["type"], "tool_result");
        assert_eq!(out.history[1]["content"][0]["type"], "thinking", "düşünme blokları olduğu gibi korunmalı");
        let _ = std::fs::remove_dir_all(root);
    }
}
