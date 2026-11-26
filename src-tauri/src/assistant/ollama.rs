//! Ücretsiz yerel yapay zeka: Ollama (https://ollama.com) — model kullanıcının
//! bilgisayarında çalışır, API ücreti ve anahtar yoktur.
//! Araç çağırmayı destekleyen modeller önerilir (qwen2.5, llama3.1).

use super::{context_note, run_tool, ChatOutcome, Ctx, Pick, ToolState, MAX_TOOL_ROUNDS};
use crate::core::http::Http;
use crate::error::{AppError, Result};
use futures::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

pub const DEFAULT_URL: &str = "http://localhost:11434";
pub const DEFAULT_MODEL: &str = "qwen2.5:7b";

/// Küçük modeller için kısaltılmış talimat (bağlam ve hız için).
const SYSTEM: &str = "Sen Ashi'sin: West Client'daki Minecraft yardımcısı. Kullanıcının dilinde (çoğunlukla Türkçe), kısa ve samimi konuş.\n\
Kurallar:\n\
1. İçerik önermeden ya da kurmadan önce search_content ile ara; İngilizce anahtar kelimeler kullan (horror, pvp, performance, magic…). Asla proje uydurma.\n\
2. Kullanıcı öneri isterse present_recommendations ile en iyi 3-5 sonucu göster.\n\
3. Kullanıcı bir şey yapmanı isterse (modpack kur, mod ekle/kapat, FPS'i artır, sunucuya hazırla) araçlarla kendin yap: modpack için create_instance, sonra her mod için install_content.\n\
4. Büyük bir değişiklikten önce (yeni modpack, 5'ten fazla mod) planı tek cümleyle söyle ve onay iste; kullanıcı onaylayınca yap.\n\
5. Cevabın 2-4 cümleyi geçmesin; ne yaptığını açıkça söyle.";

fn tools() -> Value {
    Value::Array(super::actions::defs().into_iter().map(|(name, description, parameters)| json!({ "type": "function", "function": { "name": name, "description": description, "parameters": parameters } })).collect())
}

/// Bazı modeller argümanları nesne yerine JSON metni olarak döndürür.
fn args(v: &Value) -> Value {
    match v {
        Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
        other => other.clone(),
    }
}

pub async fn chat(ctx: &Ctx<'_>, url: &str, model: &str, mut history: Vec<Value>, user_text: &str) -> Result<ChatOutcome> {
    history.push(json!({ "role": "user", "content": format!("{}\n\n{}", context_note(ctx), user_text) }));
    let mut st = ToolState::new();
    let mut reply = String::new();

    for _ in 0..=MAX_TOOL_ROUNDS {
        let mut messages = vec![json!({ "role": "system", "content": SYSTEM })];
        messages.extend(history.iter().cloned());
        let resp = ctx
            .http
            .client
            .post(format!("{}/api/chat", url.trim_end_matches('/')))
            .timeout(Duration::from_secs(240))
            .json(&json!({
                "model": model, "messages": messages, "tools": tools(), "stream": false,
                "options": { "temperature": 0.3, "num_ctx": 8192 }, "keep_alive": "10m"
            }))
            .send()
            .await
            .map_err(|_| AppError::msg("Ollama'ya bağlanılamadı (yüklü ve çalışıyor mu?)"))?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::msg(format!("\"{model}\" modeli kurulu değil; Ayarlar'dan indirebilirsin")));
        }
        let body: Value = resp.error_for_status()?.json().await?;
        let msg = body["message"].clone();
        history.push(json!({ "role": "assistant", "content": msg["content"].as_str().unwrap_or(""), "tool_calls": msg["tool_calls"] }));

        let calls = msg["tool_calls"].as_array().cloned().unwrap_or_default();
        if calls.is_empty() {
            reply = msg["content"].as_str().unwrap_or("").trim().to_string();
            break;
        }
        for c in calls {
            let name = c["function"]["name"].as_str().unwrap_or("").to_string();
            let (out, _) = run_tool(ctx, &mut st, &name, &args(&c["function"]["arguments"])).await;
            history.push(json!({ "role": "tool", "content": out, "tool_name": name }));
        }
    }

    // Küçük modeller bazen gösterme aracını atlar → son aramanın en iyilerini göster
    if st.picks.is_empty() && !st.seen.is_empty() {
        let mut hits: Vec<_> = st.seen.values().cloned().collect();
        hits.sort_by(|a, b| b.downloads.cmp(&a.downloads));
        st.picks = hits.into_iter().take(4).map(|h| Pick { reason: h.description.chars().take(90).collect(), hit: h }).collect();
    }
    if reply.is_empty() {
        reply = if st.picks.is_empty() { "Uygun bir şey bulamadım; farklı kelimelerle dener misin?".into() } else { "İşte bulduklarım:".into() };
    }
    Ok(ChatOutcome { history, reply, picks: st.picks, searches: st.searches, actions: st.actions, mode: "ollama" })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub running: bool,
    pub models: Vec<String>,
    pub model_installed: bool,
}

pub async fn status(http: &Http, url: &str, model: &str) -> OllamaStatus {
    let res = http.client.get(format!("{}/api/tags", url.trim_end_matches('/'))).timeout(Duration::from_secs(3)).send().await;
    let Ok(resp) = res else { return OllamaStatus { running: false, models: vec![], model_installed: false } };
    let v: Value = resp.json().await.unwrap_or_default();
    let models: Vec<String> = v["models"].as_array().map(|a| a.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect()).unwrap_or_default();
    let want = if model.contains(':') { model.to_string() } else { format!("{model}:latest") };
    OllamaStatus { model_installed: models.iter().any(|m| *m == want), running: true, models }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub status: String,
    pub completed: u64,
    pub total: u64,
    pub done: bool,
    pub error: Option<String>,
}

/// Modeli indirir; satır satır gelen ilerlemeyi `on` ile bildirir.
pub async fn pull(http: &Http, url: &str, model: &str, on: impl Fn(PullProgress)) -> Result<()> {
    let resp = http
        .client
        .post(format!("{}/api/pull", url.trim_end_matches('/')))
        .timeout(Duration::from_secs(6 * 3600))
        .json(&json!({ "model": model, "stream": true }))
        .send()
        .await
        .map_err(|_| AppError::msg("Ollama'ya bağlanılamadı"))?
        .error_for_status()?;
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        buf.extend_from_slice(&chunk?);
        while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let Ok(v) = serde_json::from_slice::<Value>(&line) else { continue };
            if let Some(e) = v["error"].as_str() {
                return Err(AppError::msg(format!("Model indirilemedi: {e}")));
            }
            let status = v["status"].as_str().unwrap_or("").to_string();
            on(PullProgress {
                done: status == "success",
                completed: v["completed"].as_u64().unwrap_or(0),
                total: v["total"].as_u64().unwrap_or(0),
                status,
                error: None,
            });
        }
    }
    Ok(())
}
