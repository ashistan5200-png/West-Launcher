use west_lib::assistant::{chat, ollama, Ctx, InstanceBrief, Provider};
use west_lib::core::http::Http;
#[tokio::main]
async fn main() {
    let http = Http::new();
    let url = "http://127.0.0.1:11999";
    println!("status: {:?}", ollama::status(&http, url, "qwen2.5:7b").await);
    let active = InstanceBrief { id: "s".into(), name: "Survival".into(), mc_version: "1.21.1".into(), loader: "fabric".into() };
    let ctx = Ctx { http: &http, provider: Provider::Ollama { url: url.into(), model: "qwen2.5:7b".into() }, cf_key: None, instances: vec![active.clone()], active: Some(active) };
    let out = chat(&ctx, vec![], "PvP için FPS modu öner").await.unwrap();
    println!("mode={} reply={:?} searches={:?}", out.mode, out.reply, out.searches);
    for p in &out.picks { println!("  pick: {} ({}) — {}", p.hit.title, p.hit.id, p.reason); }
    println!("history roles: {:?}", out.history.iter().map(|m| m["role"].as_str().unwrap_or("?").to_string()).collect::<Vec<_>>());
    // Ollama kapalıysa: anahtar kelime moduna düşmeli
    let ctx2 = Ctx { http: &http, provider: Provider::Ollama { url: "http://127.0.0.1:1".into(), model: "x".into() }, cf_key: None, instances: vec![], active: None };
    let out2 = chat(&ctx2, vec![], "korku modpacki öner").await.unwrap();
    println!("fallback mode={} picks={} reply starts: {:?}", out2.mode, out2.picks.len(), out2.reply.chars().take(60).collect::<String>());
}
