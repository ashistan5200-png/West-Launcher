//! Oyun ↔ launcher sosyal köprüsü.
//!
//! West Companion (oyundaki mod) sosyal özelliklere (mesajlar, arkadaşlar, davetler, durum)
//! bu köprü üzerinden ulaşır. Köprü yalnızca 127.0.0.1'de dinler ve her açılışta üretilen
//! gizli bir anahtar ister; West hesabının oturum anahtarı launcher'da kalır, oyuna verilmez.
//! İstekler `cloud::api` kapısından geçtiği için Supabase satır güvenliği kuralları aynen geçerlidir.

use crate::cloud;
use crate::core::http::Http;
use crate::error::{AppError, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::OnceLock;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub struct Bridge {
    pub port: u16,
    pub key: String,
}

static BRIDGE: OnceLock<Bridge> = OnceLock::new();

/// Köprüyü (bir kez) başlatır ve adresini döner.
pub async fn ensure(http: &Http, root: &std::path::Path) -> Result<&'static Bridge> {
    if let Some(b) = BRIDGE.get() {
        return Ok(b);
    }
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let key = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let http = http.clone();
    let root = root.to_path_buf();
    let k = key.clone();
    tokio::spawn(async move {
        loop {
            let Ok((sock, _)) = listener.accept().await else { continue };
            let (http, root, k) = (http.clone(), root.clone(), k.clone());
            tokio::spawn(async move {
                let _ = serve(sock, &http, &root, &k).await;
            });
        }
    });
    let _ = BRIDGE.set(Bridge { port, key });
    Ok(BRIDGE.get().unwrap())
}

/// Oyuna verilecek JVM argümanları
pub fn jvm_args(b: &Bridge) -> Vec<String> {
    vec![format!("-Dwest.bridge=http://127.0.0.1:{}", b.port), format!("-Dwest.bridgeKey={}", b.key)]
}

async fn serve(mut sock: TcpStream, http: &Http, root: &PathBuf, key: &str) -> Result<()> {
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];
    let head_end;
    loop {
        let n = tokio::time::timeout(std::time::Duration::from_secs(10), sock.read(&mut tmp)).await.map_err(|_| AppError::msg(crate::i18n::t("zaman aşımı")))??;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(p) = find(&buf, b"\r\n\r\n") {
            head_end = p + 4;
            break;
        }
        if buf.len() > 64 * 1024 {
            return Ok(());
        }
    }
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or_default();
    let mut parts = first.split(' ');
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();
    let mut len = 0usize;
    let mut auth_ok = false;
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
            if k == "content-length" {
                len = v.parse().unwrap_or(0).min(256 * 1024);
            }
            if k == "x-west-key" && constant_eq(v.as_bytes(), key.as_bytes()) {
                auth_ok = true;
            }
        }
    }
    while buf.len() < head_end + len {
        let n = sock.read(&mut tmp).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
    }
    let body: Value = serde_json::from_slice(&buf[head_end..(head_end + len).min(buf.len())]).unwrap_or(Value::Null);
    let (status, out) = if !auth_ok {
        (401, json!({ "error": "yetkisiz" }))
    } else {
        let (path, query) = target.split_once('?').unwrap_or((&target, ""));
        match route(http, root, &method, path, query, &body).await {
            Ok(v) => (200, v),
            Err(e) => (400, json!({ "error": e.to_string() })),
        }
    };
    let text = out.to_string();
    let resp = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
        if status == 200 { "OK" } else { "ERR" },
        text.len()
    );
    sock.write_all(resp.as_bytes()).await?;
    let _ = sock.shutdown().await;
    Ok(())
}

fn find(h: &[u8], n: &[u8]) -> Option<usize> {
    h.windows(n.len()).position(|w| w == n)
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == name).then(|| urlencoding_decode(v))
    })
}

fn urlencoding_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 2;
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Supabase isteği (launcher'ın kendi kapısından)
async fn db(http: &Http, root: &PathBuf, method: &str, table: &str, query: Vec<(&str, String)>, body: Option<Value>, prefer: Option<&str>) -> Result<Value> {
    let q: Vec<(String, String)> = query.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    cloud::api(http, root, method, &format!("/rest/v1/{table}"), &q, body, prefer).await
}

fn clean(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').take(40).collect()
}

fn uuid_ok(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}

fn in_list(ids: &[String]) -> String {
    format!("in.({})", ids.iter().filter(|i| uuid_ok(i)).map(|i| format!("\"{i}\"")).collect::<Vec<_>>().join(","))
}

const PROFILE_COLS: &str = "id,username,display_name,avatar_url,mc_username";
const INVITE_TAG: &str = "[west-davet]";

async fn me(http: &Http, root: &PathBuf) -> Result<String> {
    cloud::current_user(http, root).await.ok_or_else(|| AppError::msg(crate::i18n::t("West hesabına giriş yapılmamış")))
}

async fn profiles(http: &Http, root: &PathBuf, ids: &[String]) -> Result<Vec<Value>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let v = db(http, root, "GET", "profiles", vec![("select", PROFILE_COLS.into()), ("id", in_list(ids))], None, None).await?;
    Ok(v.as_array().cloned().unwrap_or_default())
}

async fn route(http: &Http, root: &PathBuf, method: &str, path: &str, query: &str, body: &Value) -> Result<Value> {
    match (method, path) {
        ("GET", "/me") => {
            let id = me(http, root).await?;
            Ok(profiles(http, root, &[id]).await?.into_iter().next().unwrap_or(Value::Null))
        }
        ("GET", "/friends") => {
            let id = me(http, root).await?;
            let rows = db(http, root, "GET", "follows", vec![("select", "follower_id,following_id".into()), ("or", format!("(follower_id.eq.{id},following_id.eq.{id})")), ("status", "eq.accepted".into())], None, None).await?;
            let rows = rows.as_array().cloned().unwrap_or_default();
            let following: Vec<String> = rows.iter().filter(|r| r["follower_id"] == id.as_str()).filter_map(|r| r["following_id"].as_str().map(String::from)).collect();
            let followers: Vec<String> = rows.iter().filter(|r| r["following_id"] == id.as_str()).filter_map(|r| r["follower_id"].as_str().map(String::from)).collect();
            let friends: Vec<String> = following.into_iter().filter(|f| followers.contains(f)).collect();
            let mut list = profiles(http, root, &friends).await?;
            // Durum tablosu yoksa (supabase/presence.sql çalıştırılmamış) herkes "bilinmiyor"
            let pres = db(http, root, "GET", "presence", vec![("user_id", in_list(&friends))], None, None).await.ok().and_then(|v| v.as_array().cloned()).unwrap_or_default();
            let now = chrono::Utc::now();
            for p in list.iter_mut() {
                let pr = pres.iter().find(|x| x["user_id"] == p["id"]);
                let fresh = pr
                    .and_then(|x| x["updated_at"].as_str())
                    .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                    .map(|t| (now - t.with_timezone(&chrono::Utc)).num_seconds() < 150)
                    .unwrap_or(false);
                let status = pr.and_then(|x| x["status"].as_str()).unwrap_or("offline");
                p["online"] = json!(fresh && status != "invisible");
                p["status"] = json!(if fresh { status } else { "offline" });
                p["activity"] = pr.map(|x| x["activity"].clone()).unwrap_or(Value::Null);
            }
            Ok(Value::Array(list))
        }
        ("GET", "/conversations") => {
            let id = me(http, root).await?;
            let mine = db(http, root, "GET", "conversation_members", vec![("user_id", format!("eq.{id}"))], None, None).await?;
            let mine = mine.as_array().cloned().unwrap_or_default();
            let ids: Vec<String> = mine.iter().filter_map(|m| m["conversation_id"].as_str().map(String::from)).collect();
            if ids.is_empty() {
                return Ok(json!([]));
            }
            let convs = db(http, root, "GET", "conversations", vec![("id", in_list(&ids)), ("order", "last_message_at.desc".into()), ("limit", "40".into())], None, None).await?;
            let members = db(http, root, "GET", "conversation_members", vec![("conversation_id", in_list(&ids))], None, None).await?;
            let members = members.as_array().cloned().unwrap_or_default();
            let others: Vec<String> = members.iter().filter(|m| m["user_id"] != id.as_str()).filter_map(|m| m["user_id"].as_str().map(String::from)).collect();
            let people = profiles(http, root, &others).await?;
            let mut out = vec![];
            for c in convs.as_array().cloned().unwrap_or_default() {
                let cid = c["id"].as_str().unwrap_or_default().to_string();
                let last = db(http, root, "GET", "messages", vec![("conversation_id", format!("eq.{cid}")), ("order", "created_at.desc".into()), ("limit", "1".into())], None, None)
                    .await
                    .ok()
                    .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
                    .unwrap_or(Value::Null);
                let my_read = mine.iter().find(|m| m["conversation_id"] == cid.as_str()).and_then(|m| m["last_read_at"].as_str()).unwrap_or("");
                let who: Vec<Value> = members
                    .iter()
                    .filter(|m| m["conversation_id"] == cid.as_str() && m["user_id"] != id.as_str())
                    .filter_map(|m| people.iter().find(|p| p["id"] == m["user_id"]).cloned())
                    .collect();
                let unread = last["sender_id"] != id.as_str() && last["created_at"].as_str().map(|t| t > my_read).unwrap_or(false);
                out.push(json!({
                    "id": cid, "isGroup": c["is_group"], "title": c["title"], "lastAt": c["last_message_at"],
                    "last": last["body"], "lastSender": last["sender_id"], "unread": unread, "members": who
                }));
            }
            Ok(Value::Array(out))
        }
        ("GET", "/messages") => {
            let c = param(query, "c").filter(|c| uuid_ok(c)).ok_or_else(|| AppError::msg("sohbet yok"))?;
            let id = me(http, root).await?;
            let v = db(http, root, "GET", "messages", vec![("conversation_id", format!("eq.{c}")), ("order", "created_at.desc".into()), ("limit", "60".into())], None, None).await?;
            let _ = db(http, root, "PATCH", "conversation_members", vec![("conversation_id", format!("eq.{c}")), ("user_id", format!("eq.{id}"))], Some(json!({ "last_read_at": chrono::Utc::now().to_rfc3339() })), None).await;
            let mut a = v.as_array().cloned().unwrap_or_default();
            a.reverse();
            Ok(json!({ "me": id, "messages": a }))
        }
        ("POST", "/send") => {
            let c = body["c"].as_str().filter(|c| uuid_ok(c)).ok_or_else(|| AppError::msg("sohbet yok"))?;
            let text = body["body"].as_str().unwrap_or("").trim().chars().take(2000).collect::<String>();
            if text.is_empty() {
                return Err(AppError::msg(crate::i18n::t("boş mesaj")));
            }
            db(http, root, "POST", "messages", vec![], Some(json!({ "conversation_id": c, "body": text, "media": [] })), Some("return=minimal")).await?;
            Ok(json!({ "ok": true }))
        }
        ("POST", "/dm") => {
            let u = body["user"].as_str().filter(|u| uuid_ok(u)).ok_or_else(|| AppError::msg(crate::i18n::t("kişi yok")))?;
            let v = cloud::api(http, root, "POST", "/rest/v1/rpc/start_dm", &[], Some(json!({ "other": u })), None).await?;
            Ok(json!({ "id": v }))
        }
        ("GET", "/requests") => {
            let id = me(http, root).await?;
            let rows = db(http, root, "GET", "follows", vec![("following_id", format!("eq.{id}")), ("status", "eq.pending".into()), ("limit", "50".into())], None, None).await?;
            let ids: Vec<String> = rows.as_array().cloned().unwrap_or_default().iter().filter_map(|r| r["follower_id"].as_str().map(String::from)).collect();
            let follows = profiles(http, root, &ids).await?;
            // Son 6 saatteki dünya davetleri (mesaj olarak gelir)
            let since = (chrono::Utc::now() - chrono::Duration::hours(6)).to_rfc3339();
            let inv = db(http, root, "GET", "messages", vec![("body", format!("like.{INVITE_TAG}*")), ("sender_id", format!("neq.{id}")), ("created_at", format!("gt.{since}")), ("order", "created_at.desc".into()), ("limit", "20".into())], None, None).await?;
            let inv = inv.as_array().cloned().unwrap_or_default();
            let senders: Vec<String> = inv.iter().filter_map(|m| m["sender_id"].as_str().map(String::from)).collect();
            let who = profiles(http, root, &senders).await?;
            let invites: Vec<Value> = inv
                .iter()
                .filter_map(|m| {
                    let b = m["body"].as_str()?.strip_prefix(INVITE_TAG)?.trim();
                    let d: Value = serde_json::from_str(b).ok()?;
                    Some(json!({
                        "from": who.iter().find(|p| p["id"] == m["sender_id"]).cloned().unwrap_or(Value::Null),
                        "world": d["world"], "address": d["address"], "at": m["created_at"], "conversation": m["conversation_id"],
                        "version": d["version"], "loader": d["loader"], "kind": d["kind"], "offline": d["offline"]
                    }))
                })
                .collect();
            Ok(json!({ "follows": follows, "invites": invites }))
        }
        ("POST", "/accept") | ("POST", "/decline") => {
            let id = me(http, root).await?;
            let u = body["user"].as_str().filter(|u| uuid_ok(u)).ok_or_else(|| AppError::msg(crate::i18n::t("kişi yok")))?;
            if path == "/accept" {
                db(http, root, "PATCH", "follows", vec![("follower_id", format!("eq.{u}")), ("following_id", format!("eq.{id}"))], Some(json!({ "status": "accepted" })), None).await?;
                // Arkadaşlık karşılıklı takip: geri takip et
                let _ = db(http, root, "POST", "follows", vec![], Some(json!({ "follower_id": id, "following_id": u })), Some("resolution=ignore-duplicates")).await;
            } else {
                db(http, root, "DELETE", "follows", vec![("follower_id", format!("eq.{u}")), ("following_id", format!("eq.{id}"))], None, None).await?;
            }
            Ok(json!({ "ok": true }))
        }
        ("POST", "/add") => {
            let id = me(http, root).await?;
            let name = clean(body["username"].as_str().unwrap_or(""));
            if name.is_empty() {
                return Err(AppError::msg(crate::i18n::t("kullanıcı adı yaz")));
            }
            let v = db(http, root, "GET", "profiles", vec![("select", PROFILE_COLS.into()), ("username", format!("ilike.{name}")), ("limit", "1".into())], None, None).await?;
            let p = v.as_array().and_then(|a| a.first().cloned()).ok_or_else(|| AppError::msg(crate::i18n::t("Bu kullanıcı adıyla bir West hesabı yok")))?;
            let other = p["id"].as_str().unwrap_or_default();
            if other == id {
                return Err(AppError::msg("Kendini ekleyemezsin"));
            }
            db(http, root, "POST", "follows", vec![], Some(json!({ "follower_id": id, "following_id": other })), Some("resolution=ignore-duplicates")).await?;
            Ok(p)
        }
        ("POST", "/invite") => {
            let users: Vec<String> = body["users"].as_array().cloned().unwrap_or_default().iter().filter_map(|u| u.as_str().map(String::from)).filter(|u| uuid_ok(u)).take(20).collect();
            let s = |k: &str, n: usize| body[k].as_str().unwrap_or("").chars().take(n).collect::<String>();
            let payload = json!({
                "world": s("world", 60),
                "address": s("address", 80),
                "kind": s("kind", 10),
                "version": s("version", 20),
                "loader": s("loader", 20),
                "offline": body["offline"].as_bool().unwrap_or(false),
            });
            let mut sent = 0;
            for u in users {
                let Ok(conv) = cloud::api(http, root, "POST", "/rest/v1/rpc/start_dm", &[], Some(json!({ "other": u })), None).await else { continue };
                let Some(c) = conv.as_str() else { continue };
                if db(http, root, "POST", "messages", vec![], Some(json!({ "conversation_id": c, "body": format!("{INVITE_TAG} {payload}"), "media": [] })), Some("return=minimal")).await.is_ok() {
                    sent += 1;
                }
            }
            Ok(json!({ "sent": sent }))
        }
        ("POST", "/presence") => {
            let id = me(http, root).await?;
            let status = match body["status"].as_str().unwrap_or("online") {
                s @ ("online" | "away" | "busy" | "invisible") => s,
                _ => "online",
            };
            let activity = body["activity"].as_str().map(|a| a.chars().take(80).collect::<String>());
            let _ = db(http, root, "POST", "presence", vec![], Some(json!({ "user_id": id, "status": status, "activity": activity, "updated_at": chrono::Utc::now().to_rfc3339() })), Some("resolution=merge-duplicates")).await;
            Ok(json!({ "ok": true }))
        }
        ("GET", "/search") => {
            let q = clean(&param(query, "q").unwrap_or_default());
            if q.is_empty() {
                return Ok(json!([]));
            }
            db(http, root, "GET", "profiles", vec![("select", PROFILE_COLS.into()), ("username", format!("ilike.*{q}*")), ("limit", "10".into())], None, None).await
        }
        // ───── Ana menü lobisi ─────
        ("POST", "/lobby/rpc") => {
            const ALLOWED: [&str; 14] = [
                "lobby_verify_start", "lobby_state", "lobby_invite", "lobby_accept", "lobby_decline", "lobby_join", "lobby_leave", "lobby_kick",
                "lobby_set_privacy", "lobby_set_biome", "lobby_presence_set", "lobby_settings_set", "lobby_block", "lobby_delete_my_data",
            ];
            let f = body["fn"].as_str().unwrap_or_default();
            if !ALLOWED.contains(&f) {
                return Err(AppError::msg("bilinmeyen istek"));
            }
            let args = if body["args"].is_object() { body["args"].clone() } else { json!({}) };
            match cloud::api(http, root, "POST", &format!("/rest/v1/rpc/{f}"), &[], Some(args), None).await {
                Ok(v) => Ok(json!({ "result": v })),
                Err(e) if e.to_string().contains("social.sql") => Err(AppError::msg(crate::i18n::t("Lobi için Supabase'te supabase/lobby.sql dosyası henüz çalıştırılmamış."))),
                Err(e) => Err(e),
            }
        }
        ("POST", "/lobby/verify") => {
            let name = body["name"].as_str().unwrap_or_default();
            if name.is_empty() || name.len() > 16 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
            }
            cloud::function(http, root, "lobby-verify", json!({ "name": name })).await
        }
        ("GET", "/lobby/realtime") => cloud::realtime(http, root).await,
        _ => Err(AppError::msg("bilinmeyen istek")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsing_helpers() {
        assert_eq!(urlencoding_decode("a%20b+c"), "a b c");
        assert_eq!(param("c=12&q=x%C4%B1", "q").unwrap(), "xı");
        assert!(constant_eq(b"abc", b"abc"));
        assert!(!constant_eq(b"abc", b"abd"));
        assert_eq!(clean("ali'; drop"), "alidrop");
        assert_eq!(in_list(&["nope".into()]), "in.()");
    }
}
