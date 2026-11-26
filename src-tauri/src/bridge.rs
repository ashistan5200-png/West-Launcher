//! Oyun ↔ launcher köprüsü.
//!
//! West Companion (oyundaki mod) Mod Merkezi'ni (canlı mod aç/kapa, kurma, setler, geri dönüş
//! noktaları, oyun kapanmadan yeniden başlatma) bu köprü üzerinden çalıştırır. Köprü yalnızca
//! 127.0.0.1'de dinler ve her açılışta üretilen gizli bir anahtar ister.


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
pub fn jvm_args(b: &Bridge, instance_id: &str) -> Vec<String> {
    vec![format!("-Dwest.bridge=http://127.0.0.1:{}", b.port), format!("-Dwest.bridgeKey={}", b.key), format!("-Dwest.instance={instance_id}")]
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
                len = v.parse().unwrap_or(0).min(1024 * 1024);
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

#[cfg(test)]
fn param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == name).then(|| urlencoding_decode(v))
    })
}

pub fn decode_query(s: &str) -> String {
    urlencoding_decode(s)
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

async fn route(_http: &Http, _root: &PathBuf, method: &str, path: &str, query: &str, body: &Value) -> Result<Value> {
    // Oyun içi mod merkezi. (West sosyal kaldırıldı: arkadaşlar, mesajlar, davetler ve durum artık yok.)
    if path.starts_with("/mods/") || path.starts_with("/perf/") {
        return crate::livemods::route(method, path, query, body).await;
    }
    Err(AppError::msg("bilinmeyen istek"))
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
    }
}
