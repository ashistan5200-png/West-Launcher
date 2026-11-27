//! Arkadaşla paket senkronu. Sahip, instance'ın açık içeriğini (Modrinth projeleri) kısa bir kodla
//! yayınlar; kodu kullanan arkadaşın launcher'ı aynı paketi kurar ve sahip listeyi değiştirdikçe
//! "Güncelleme var" der. Liste West hesabının veritabanında (Supabase, `pack_syncs`) durur.

use crate::content::manage;
use crate::error::{AppError, Result};
use crate::instance::{Instance, InstanceManager, Loader, LoaderKind, NewInstance};
use crate::setshare::SharedSet;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Instance'ın senkron bilgisi (instance klasöründe sync.json)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncLink {
    pub code: String,
    /// "owner" | "member"
    pub role: String,
    /// Son uygulanan/yayınlanan sürümün zamanı (sunucunun updated_at değeri)
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub link: Option<SyncLink>,
    /// Üye için: sahip yeni bir liste yayınladı
    pub has_update: bool,
    pub remote_name: Option<String>,
    pub remote_updated_at: Option<String>,
}

fn link_path(state: &AppState, id: &str) -> std::path::PathBuf {
    state.paths.instance_dir(id).join("sync.json")
}

fn load_link(state: &AppState, id: &str) -> Option<SyncLink> {
    std::fs::read(link_path(state, id)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn save_link(state: &AppState, id: &str, l: &SyncLink) -> Result<()> {
    crate::util::write_json_atomic(&link_path(state, id), l)
}

fn new_code() -> String {
    const A: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let r = uuid::Uuid::new_v4();
    r.as_bytes().iter().take(7).map(|b| A[(*b as usize) % A.len()] as char).collect()
}

pub(crate) fn loader_name(k: LoaderKind) -> &'static str {
    match k {
        LoaderKind::Vanilla => "vanilla",
        LoaderKind::Fabric => "fabric",
        LoaderKind::Quilt => "quilt",
        LoaderKind::Forge => "forge",
        LoaderKind::NeoForge => "neoforge",
    }
}

pub(crate) fn loader_kind(s: &str) -> LoaderKind {
    match s {
        "fabric" => LoaderKind::Fabric,
        "quilt" => LoaderKind::Quilt,
        "forge" => LoaderKind::Forge,
        "neoforge" => LoaderKind::NeoForge,
        _ => LoaderKind::Vanilla,
    }
}

/// Instance'ın şu anki açık içeriği → paylaşılabilir liste
fn manifest_of(state: &AppState, inst: &Instance) -> Result<SharedSet> {
    let files = manage::list(&state.paths.instance_dir(&inst.id), &state.paths.instance_game_dir(&inst.id));
    let enabled: Vec<String> = files.iter().filter(|f| f.enabled && !f.managed).map(|f| f.id.clone()).collect();
    let code = crate::setshare::encode(&inst.name, &inst.mc_version, loader_name(inst.loader.kind), &enabled, &files)?.0;
    crate::setshare::decode(&code)
}

async fn fetch(state: &AppState, code: &str) -> Result<Value> {
    let rows = crate::cloud::api(&state.http, &state.paths.root, "GET", "/rest/v1/pack_syncs", &[("code".into(), format!("eq.{code}")), ("select".into(), "code,name,manifest,updated_at".into())], None, None).await?;
    rows.as_array().and_then(|a| a.first()).cloned().ok_or_else(|| AppError::msg(crate::i18n::t("Bu kodla paylaşılan bir paket yok.")))
}

/// Paketi yayınla ya da (sahibiysen) güncelle. Kodu döner.
pub async fn publish(state: &AppState, id: &str) -> Result<String> {
    let inst = InstanceManager::new(&state.paths).get(id)?;
    let set = manifest_of(state, &inst)?;
    let link = load_link(state, id).filter(|l| l.role == "owner");
    let body = json!({ "name": inst.name.chars().take(64).collect::<String>(), "manifest": set, "updated_at": chrono::Utc::now().to_rfc3339() });
    let (code, row) = match link {
        Some(l) => {
            let r = crate::cloud::api(&state.http, &state.paths.root, "PATCH", "/rest/v1/pack_syncs", &[("code".into(), format!("eq.{}", l.code))], Some(body), Some("return=representation")).await?;
            (l.code, r)
        }
        None => {
            let code = new_code();
            let mut b = body;
            b["code"] = json!(code);
            let r = crate::cloud::api(&state.http, &state.paths.root, "POST", "/rest/v1/pack_syncs", &[], Some(b), Some("return=representation")).await?;
            (code, r)
        }
    };
    let updated = row.as_array().and_then(|a| a.first()).and_then(|r| r["updated_at"].as_str()).unwrap_or_default().to_string();
    save_link(state, id, &SyncLink { code: code.clone(), role: "owner".into(), updated_at: updated })?;
    Ok(code)
}

/// Koddaki paketi yeni bir instance olarak kur
pub async fn join(state: &AppState, code: &str) -> Result<Instance> {
    let code = code.trim().to_uppercase();
    let row = fetch(state, &code).await?;
    let set: SharedSet = serde_json::from_value(row["manifest"].clone()).map_err(|_| AppError::msg(crate::i18n::t("Paylaşılan paket okunamadı.")))?;
    let inst = InstanceManager::new(&state.paths).create(NewInstance {
        name: row["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(&set.n).to_string(),
        mc_version: set.mc.clone(),
        loader: Loader { kind: loader_kind(&set.l), version: None },
        icon: None,
        group: Some(crate::i18n::t("Arkadaş paketleri")),
    })?;
    crate::livemods::import_set(state, &inst.id, &crate::setshare::pack(&set)?, false).await?;
    save_link(state, &inst.id, &SyncLink { code, role: "member".into(), updated_at: row["updated_at"].as_str().unwrap_or_default().to_string() })?;
    Ok(inst)
}

pub async fn status(state: &AppState, id: &str) -> Result<SyncStatus> {
    let Some(link) = load_link(state, id) else {
        return Ok(SyncStatus { link: None, has_update: false, remote_name: None, remote_updated_at: None });
    };
    let row = fetch(state, &link.code).await.ok();
    let remote = row.as_ref().and_then(|r| r["updated_at"].as_str()).map(String::from);
    let has_update = link.role == "member" && remote.as_deref().is_some_and(|r| r != link.updated_at);
    Ok(SyncStatus { remote_name: row.as_ref().and_then(|r| r["name"].as_str()).map(String::from), remote_updated_at: remote, has_update, link: Some(link) })
}

/// Üye: sahibin son listesini uygula (eksikler kurulur, listede olmayanlar kapanır)
pub async fn pull(state: &AppState, id: &str) -> Result<crate::livemods::ImportReport> {
    let mut link = load_link(state, id).ok_or_else(|| AppError::msg(crate::i18n::t("Bu instance bir paylaşılan pakete bağlı değil.")))?;
    let row = fetch(state, &link.code).await?;
    let set: SharedSet = serde_json::from_value(row["manifest"].clone()).map_err(|_| AppError::msg(crate::i18n::t("Paylaşılan paket okunamadı.")))?;
    let running = state.running.lock().contains_key(id);
    let rep = crate::livemods::import_set(state, id, &crate::setshare::pack(&set)?, running).await?;
    link.updated_at = row["updated_at"].as_str().unwrap_or_default().to_string();
    save_link(state, id, &link)?;
    Ok(rep)
}

pub fn unlink(state: &AppState, id: &str) -> Result<()> {
    let p = link_path(state, id);
    if p.exists() {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn codes_are_valid_for_the_table() {
        for _ in 0..50 {
            let c = super::new_code();
            assert_eq!(c.len(), 7);
            assert!(c.chars().all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit()));
        }
    }
}
