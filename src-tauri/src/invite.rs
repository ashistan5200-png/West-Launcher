//! Discord'dan "Birlikte oyna". Oyun açılınca paketin içeriği (Modrinth kimlikleri, sürüm,
//! yükleyici) ve sunucu adresi Supabase'te 8 haneli bir davetle saklanır (supabase/play_invites.sql).
//! Discord'daki düğme westclient.app/katil?k=KOD'a gider; oradan westclient://katil/KOD ile
//! arkadaşın launcher'ı açılır, aynı paketi kurar ve aynı sunucuya girer.

use crate::content::manage;
use crate::error::{AppError, Result};
use crate::instance::{Instance, InstanceManager, Loader, NewInstance};
use crate::setshare::SharedSet;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

/// Davetler sunucuda 7 gün yaşar; 6 günden eskisi yenilenir
const REUSE_SECS: i64 = 6 * 86400;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Cached {
    hash: String,
    code: String,
    at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteInfo {
    pub code: String,
    pub name: String,
    pub mc: String,
    pub loader: String,
    pub mods: usize,
    pub packs: usize,
    pub server: Option<String>,
    /// Bu davetle daha önce kurulmuş instance (varsa yeniden kurulmaz)
    pub installed: Option<String>,
}

/// Davetle kurulan instance'ın kaydı
#[derive(Debug, Clone, Serialize, Deserialize)]
struct FromInvite {
    code: String,
}

fn cache_path(state: &AppState, id: &str) -> std::path::PathBuf {
    state.paths.instance_dir(id).join("invite.json")
}

fn from_path(state: &AppState, id: &str) -> std::path::PathBuf {
    state.paths.instance_dir(id).join("invited-by.json")
}

/// Instance'ın paylaşılabilir içeriği. Modrinth'te olmayan dosyalar girmez; içerik yoksa
/// (vanilla) yalnızca sürüm ve yükleyici paylaşılır.
fn manifest(state: &AppState, inst: &Instance) -> SharedSet {
    let files = manage::list(&state.paths.instance_dir(&inst.id), &state.paths.instance_game_dir(&inst.id));
    let enabled: Vec<String> = files.iter().filter(|f| f.enabled && !f.managed).map(|f| f.id.clone()).collect();
    let loader = crate::packsync::loader_name(inst.loader.kind);
    crate::setshare::encode(&inst.name, &inst.mc_version, loader, &enabled, &files)
        .and_then(|(code, _)| crate::setshare::decode(&code))
        .unwrap_or_else(|_| SharedSet { v: 1, n: inst.name.chars().take(32).collect(), mc: inst.mc_version.clone(), l: loader.into(), m: vec![], r: vec![], s: vec![] })
}

fn clean_code(code: &str) -> Result<String> {
    let c: String = code.trim().to_uppercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if c.len() != 8 {
        return Err(AppError::msg(crate::i18n::t("Davet kodu geçersiz.")));
    }
    Ok(c)
}

/// Oynanan paket için davet kodu (aynı içerik ve sunucu için öncekini kullanır)
pub async fn ensure(state: &AppState, inst_id: &str, server: Option<&str>) -> Result<String> {
    let inst = InstanceManager::new(&state.paths).get(inst_id)?;
    let set = manifest(state, &inst);
    let server = server.map(str::trim).filter(|s| !s.is_empty());
    let body = serde_json::to_string(&set)?;
    let hash = hex::encode(Sha256::digest(format!("{body}|{}", server.unwrap_or_default()).as_bytes()));
    let now = chrono::Utc::now().timestamp();
    if let Some(c) = std::fs::read(cache_path(state, inst_id)).ok().and_then(|b| serde_json::from_slice::<Cached>(&b).ok()) {
        if c.hash == hash && now - c.at < REUSE_SECS {
            return Ok(c.code);
        }
    }
    let v = crate::cloud::api(
        &state.http,
        &state.paths.root,
        "POST",
        "/rest/v1/rpc/create_play_invite",
        &[],
        Some(json!({ "p_name": inst.name.chars().take(64).collect::<String>(), "p_manifest": set, "p_server": server })),
        None,
    )
    .await?;
    let code = v.as_str().map(str::to_string).ok_or_else(|| AppError::msg(crate::i18n::t("Davet oluşturulamadı.")))?;
    let _ = std::fs::write(cache_path(state, inst_id), serde_json::to_vec(&Cached { hash, code: code.clone(), at: now })?);
    Ok(code)
}

async fn fetch(state: &AppState, code: &str) -> Result<(serde_json::Value, SharedSet)> {
    let v = crate::cloud::api(&state.http, &state.paths.root, "POST", "/rest/v1/rpc/get_play_invite", &[], Some(json!({ "p_code": code })), None).await?;
    if v.is_null() {
        return Err(AppError::msg(crate::i18n::t("Bu davetin süresi dolmuş ya da hiç yok. Arkadaşından oyunu yeniden açmasını iste.")));
    }
    let set: SharedSet = serde_json::from_value(v["manifest"].clone()).map_err(|_| AppError::msg(crate::i18n::t("Davet okunamadı.")))?;
    Ok((v, set))
}

/// Bu davetle daha önce kurulmuş instance
fn installed_for(state: &AppState, code: &str) -> Option<String> {
    let list = InstanceManager::new(&state.paths).list().ok()?;
    list.into_iter()
        .find(|i| std::fs::read(from_path(state, &i.id)).ok().and_then(|b| serde_json::from_slice::<FromInvite>(&b).ok()).is_some_and(|f| f.code == code))
        .map(|i| i.id)
}

/// Davetin özeti (onay penceresi için)
pub async fn info(state: &AppState, code: &str) -> Result<InviteInfo> {
    let code = clean_code(code)?;
    let (v, set) = fetch(state, &code).await?;
    Ok(InviteInfo {
        name: v["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(&set.n).to_string(),
        mc: set.mc.clone(),
        loader: set.l.clone(),
        mods: set.m.len(),
        packs: set.r.len() + set.s.len(),
        server: v["server"].as_str().map(str::to_string),
        installed: installed_for(state, &code),
        code,
    })
}

/// Davetteki paketi kur (daha önce kurulduysa onu döner). Sunucuya katılmayı arayüz yapar.
pub async fn install(state: &AppState, code: &str) -> Result<Instance> {
    let code = clean_code(code)?;
    let mgr = InstanceManager::new(&state.paths);
    if let Some(id) = installed_for(state, &code) {
        return mgr.get(&id);
    }
    let (v, set) = fetch(state, &code).await?;
    let inst = mgr.create(NewInstance {
        name: v["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(&set.n).to_string(),
        mc_version: set.mc.clone(),
        loader: Loader { kind: crate::packsync::loader_kind(&set.l), version: None },
        icon: None,
        group: Some(crate::i18n::t("Arkadaş paketleri")),
    })?;
    std::fs::write(from_path(state, &inst.id), serde_json::to_vec(&FromInvite { code })?)?;
    if !(set.m.is_empty() && set.r.is_empty() && set.s.is_empty()) {
        crate::livemods::import_set(state, &inst.id, &crate::setshare::pack(&set)?, false).await?;
    }
    Ok(inst)
}

/// westclient://katil/KOD ya da westclient://katil?k=KOD → KOD
pub fn code_from_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("westclient://")?;
    let rest = rest.trim_end_matches('/');
    let code = if let Some(q) = rest.split_once("k=") { q.1.split('&').next().unwrap_or_default() } else { rest.rsplit('/').next().unwrap_or_default() };
    clean_code(code).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(code_from_url("westclient://katil/ab12cd34").as_deref(), Some("AB12CD34"));
        assert_eq!(code_from_url("westclient://katil/AB12CD34/").as_deref(), Some("AB12CD34"));
        assert_eq!(code_from_url("westclient://katil?k=AB12CD34&x=1").as_deref(), Some("AB12CD34"));
        assert_eq!(code_from_url("westclient://katil/kisa"), None);
        assert_eq!(code_from_url("https://evil/katil/AB12CD34"), None);
    }
}
