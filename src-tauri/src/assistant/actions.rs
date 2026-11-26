//! Ashi'nin eylem araçları: yalnızca önermekle kalmaz, launcher'da iş yapar.
//! Araç tanımları sağlayıcıdan bağımsızdır (Claude ve Ollama aynı listeyi kullanır); her araç
//! modelin okuyacağı kısa bir JSON metni döner. Yapılan her değişiklik `actions` listesine yazılır
//! ve sohbette kullanıcıya gösterilir.

use crate::content::install::{install, InstallCtx};
use crate::content::{manage, Kind, Source};
use crate::instance::{InstanceManager, Loader, LoaderKind, NewInstance};
use crate::state::AppState;
use serde_json::{json, Value};

/// Sağlayıcıdan bağımsız araç tanımları: (ad, açıklama, JSON şeması)
pub fn defs() -> Vec<(&'static str, &'static str, Value)> {
    vec![
        ("search_content", "Modrinth (ve anahtar varsa CurseForge) üzerinde Minecraft içeriği arar. İngilizce anahtar kelimeler kullan (horror, pvp, performance, magic, tech…). Sonuçlardaki id ve source değerlerini sonraki araçlarda kullan.", json!({
            "type": "object", "required": ["query", "kind"], "properties": {
                "query": { "type": "string", "description": "İngilizce arama terimleri" },
                "kind": { "type": "string", "enum": ["mod", "modpack", "shader", "resourcepack"] },
                "game_version": { "type": "string", "description": "Ör. 1.21.1; bilinmiyorsa verme" },
                "loader": { "type": "string", "enum": ["fabric", "quilt", "forge", "neoforge"] }
            }
        })),
        ("list_instances", "Kullanıcının instance'larını (id, ad, Minecraft sürümü, yükleyici) listeler.", json!({ "type": "object", "properties": {} })),
        ("list_installed", "Bir instance'ta kurulu modları, paketleri ve shader'ları (dosya kimliği, ad, açık/kapalı) listeler.", json!({
            "type": "object", "required": ["instance_id"], "properties": { "instance_id": { "type": "string" } }
        })),
        ("create_instance", "Yeni bir instance (paket) oluşturur. Modpack kurarken önce bunu çağır, sonra install_content ile modları ekle. Yükleyici sürümü otomatik seçilir.", json!({
            "type": "object", "required": ["name", "mc_version", "loader"], "properties": {
                "name": { "type": "string", "description": "Kısa ve anlamlı ad (ör. 'Korku Macerası')" },
                "mc_version": { "type": "string", "description": "Ör. 1.21.1. Seçtiğin modların çoğunun desteklediği sürüm olmalı." },
                "loader": { "type": "string", "enum": ["vanilla", "fabric", "quilt", "forge", "neoforge"] }
            }
        })),
        ("install_content", "Bir Modrinth projesini instance'a kurar; uyumlu en yeni sürümü ve gerekli kütüphaneleri seçer. project_id search_content sonucundaki id'dir.", json!({
            "type": "object", "required": ["instance_id", "project_id", "kind"], "properties": {
                "instance_id": { "type": "string" },
                "project_id": { "type": "string" },
                "kind": { "type": "string", "enum": ["mod", "shader", "resourcepack"] }
            }
        })),
        ("set_enabled", "Kurulu içerikleri açar ya da kapatır (silmez). file_ids list_installed'daki id değerleridir (ör. 'mods/sodium.jar').", json!({
            "type": "object", "required": ["instance_id", "file_ids", "enabled"], "properties": {
                "instance_id": { "type": "string" },
                "file_ids": { "type": "array", "items": { "type": "string" } },
                "enabled": { "type": "boolean" }
            }
        })),
        ("fps_pack", "Instance'a yükleyicisine uygun performans modlarını (Sodium, Lithium, FerriteCore…) kurar; zaten kurulu ya da çakışanları atlar.", json!({
            "type": "object", "required": ["instance_id"], "properties": { "instance_id": { "type": "string" } }
        })),
        ("prepare_server", "Bir Minecraft sunucusunu sorgular; sürümüne ve (Forge/NeoForge ise) mod listesine göre hazır bir instance kurar ve sunucuyu listesine ekler.", json!({
            "type": "object", "required": ["address"], "properties": { "address": { "type": "string", "description": "ör. play.ornek.com" } }
        })),
        ("analyze_crash", "Instance'ın son çökme raporunu okuyup nedenini ve suçlu modu bulur.", json!({
            "type": "object", "required": ["instance_id"], "properties": { "instance_id": { "type": "string" } }
        })),
        ("present_recommendations", "Seçtiğin arama sonuçlarını kullanıcıya tek tıkla kurulabilir kart olarak gösterir. Yalnızca öneri istendiğinde ya da kurmadan önce seçenek sunarken kullan.", json!({
            "type": "object", "required": ["items"], "properties": {
                "items": { "type": "array", "items": { "type": "object", "required": ["source", "id", "reason"], "properties": {
                    "source": { "type": "string", "enum": ["modrinth", "curseforge"] },
                    "id": { "type": "string" },
                    "reason": { "type": "string", "description": "Tek cümle: neden bu" }
                } } }
            }
        })),
    ]
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("").trim()
}

fn loader_kind(s: &str) -> Option<LoaderKind> {
    Some(match s {
        "vanilla" => LoaderKind::Vanilla,
        "fabric" => LoaderKind::Fabric,
        "quilt" => LoaderKind::Quilt,
        "forge" => LoaderKind::Forge,
        "neoforge" => LoaderKind::NeoForge,
        _ => return None,
    })
}

fn not_running(state: &AppState, id: &str) -> Result<(), String> {
    if state.running.lock().contains_key(id) {
        Err("Bu instance şu an oyunda açık; değişiklik için kullanıcının oyunu kapatması gerekir.".into())
    } else {
        Ok(())
    }
}

/// Eylem araçlarını çalıştırır. Döner: (modele gidecek metin, hata mı). Eylem değilse None.
pub async fn run(state: &AppState, name: &str, input: &Value, actions: &mut Vec<String>) -> Option<(String, bool)> {
    let r: Result<String, String> = match name {
        "list_installed" => {
            let id = s(input, "instance_id");
            let files = manage::list(&state.paths.instance_dir(id), &state.paths.instance_game_dir(id));
            Ok(json!({ "items": files.iter().map(|f| json!({ "id": f.id, "title": f.title, "kind": f.kind, "enabled": f.enabled, "version": f.version })).collect::<Vec<_>>() }).to_string())
        }
        "create_instance" => {
            let (name, mc) = (s(input, "name"), s(input, "mc_version"));
            match (loader_kind(s(input, "loader")), name.is_empty(), mc.is_empty()) {
                (Some(kind), false, false) => match InstanceManager::new(&state.paths).create(NewInstance {
                    name: name.chars().take(48).collect(),
                    mc_version: mc.to_string(),
                    loader: Loader { kind, version: None },
                    icon: None,
                    group: Some("Ashi".into()),
                }) {
                    Ok(i) => {
                        actions.push(format!("Instance oluşturuldu: {} ({} {})", i.name, s(input, "loader"), i.mc_version));
                        Ok(json!({ "instance_id": i.id, "name": i.name }).to_string())
                    }
                    Err(e) => Err(e.to_string()),
                },
                _ => Err("name, mc_version ve geçerli bir loader gerekli".into()),
            }
        }
        "install_content" => {
            let (id, pid) = (s(input, "instance_id"), s(input, "project_id"));
            let kind = match s(input, "kind") {
                "shader" => Kind::Shader,
                "resourcepack" => Kind::Resourcepack,
                _ => Kind::Mod,
            };
            match (not_running(state, id), InstanceManager::new(&state.paths).get(id)) {
                (Err(e), _) => Err(e),
                (_, Err(e)) => Err(e.to_string()),
                (Ok(()), Ok(inst)) => {
                    let ctx = InstallCtx {
                        http: &state.http,
                        cf_key: None,
                        instance_id: id,
                        instance_dir: state.paths.instance_dir(id),
                        game_dir: state.paths.instance_game_dir(id),
                        mc_version: inst.mc_version.clone(),
                        loader: crate::commands::content::loader_slug(inst.loader.kind),
                        progress: std::sync::Arc::new(|_| {}),
                    };
                    match install(&ctx, Source::Modrinth, pid, kind).await {
                        Ok(rep) => {
                            for i in &rep.installed {
                                actions.push(format!("{} kuruldu → {}", i.title, inst.name));
                            }
                            Ok(json!({ "installed": rep.installed.iter().map(|i| &i.title).collect::<Vec<_>>(), "skipped": rep.skipped, "warnings": rep.warnings }).to_string())
                        }
                        Err(e) => Err(format!("Kurulamadı: {e}")),
                    }
                }
            }
        }
        "set_enabled" => {
            let id = s(input, "instance_id");
            let ids: Vec<String> = input["file_ids"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            let on = input["enabled"].as_bool().unwrap_or(true);
            match not_running(state, id) {
                Err(e) => Err(e),
                Ok(()) => match manage::set_enabled(&state.paths.instance_game_dir(id), &ids, on) {
                    Ok(()) => {
                        actions.push(format!("{} içerik {}", ids.len(), if on { "açıldı" } else { "kapatıldı" }));
                        Ok(json!({ "ok": true, "count": ids.len() }).to_string())
                    }
                    Err(e) => Err(e.to_string()),
                },
            }
        }
        "fps_pack" => {
            let id = s(input, "instance_id");
            match (not_running(state, id), InstanceManager::new(&state.paths).get(id)) {
                (Err(e), _) => Err(e),
                (_, Err(e)) => Err(e.to_string()),
                (Ok(()), Ok(inst)) => match crate::features::fps_plan(state, &inst).await {
                    Err(e) => Err(e.to_string()),
                    Ok(plan) => {
                        let ctx = InstallCtx {
                            http: &state.http,
                            cf_key: None,
                            instance_id: id,
                            instance_dir: state.paths.instance_dir(id),
                            game_dir: state.paths.instance_game_dir(id),
                            mc_version: inst.mc_version.clone(),
                            loader: crate::commands::content::loader_slug(inst.loader.kind),
                            progress: std::sync::Arc::new(|_| {}),
                        };
                        let mut done = vec![];
                        for p in plan.iter().filter(|p| p.status == "install") {
                            if install(&ctx, Source::Modrinth, &p.slug, Kind::Mod).await.is_ok() {
                                done.push(p.title.clone());
                            }
                        }
                        if !done.is_empty() {
                            actions.push(format!("FPS paketi → {}: {}", inst.name, done.join(", ")));
                        }
                        Ok(json!({ "installed": done, "already": plan.iter().filter(|p| p.status == "installed").map(|p| &p.title).collect::<Vec<_>>() }).to_string())
                    }
                },
            }
        }
        "prepare_server" => match crate::features::server_prep(state, s(input, "address"), None, std::sync::Arc::new(|_| {})).await {
            Ok(r) => {
                actions.push(format!("Sunucu paketi hazır: {} (Minecraft {})", r.instance.name, r.instance.mc_version));
                Ok(json!({ "instance_id": r.instance.id, "mc_version": r.instance.mc_version, "installed_mods": r.installed, "missing": r.missing, "players": format!("{}/{}", r.probe.online, r.probe.max) }).to_string())
            }
            Err(e) => Err(e.to_string()),
        },
        "analyze_crash" => {
            let gd = state.paths.instance_game_dir(s(input, "instance_id"));
            match tokio::task::spawn_blocking(move || crate::crash::analyze::analyze(&gd, None)).await {
                Ok(Some(a)) => Ok(serde_json::to_string(&a).unwrap_or_default()),
                Ok(None) => Ok("Bu instance'ta okunacak bir çökme raporu ya da hata kaydı yok.".into()),
                Err(e) => Err(e.to_string()),
            }
        }
        _ => return None,
    };
    Some(match r {
        Ok(t) => (t, false),
        Err(e) => (e, true),
    })
}
