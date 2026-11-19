//! West Depo komutları: dosya inceleme, yükleme, kurulum.
use crate::cloud;
use crate::commands::content::loader_slug;
use crate::commands::progress_emitter;
use crate::core::report;
use crate::depot::{self, Inspect, Installed};
use crate::error::{AppError, Result};
use crate::instance::InstanceManager;
use crate::state::AppState;
use futures::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tokio::io::AsyncWriteExt;

#[tauri::command]
pub async fn depot_inspect(path: String) -> Result<Inspect> {
    tokio::task::spawn_blocking(move || depot::inspect(std::path::Path::new(&path))).await.map_err(|e| AppError::msg(e.to_string()))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Uploaded {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub sha256: String,
    pub kind: String,
}

/// Dosyayı yeniden doğrular ve Depo'ya yükler. Kayıt (başlık, açıklama…) arayüzden ayrıca eklenir;
/// veritabanı yolun yükleyenin kendi klasöründe olduğunu ve rolünü ayrıca denetler.
#[tauri::command]
pub async fn depot_upload(state: State<'_, AppState>, path: String) -> Result<Uploaded> {
    let p = std::path::PathBuf::from(&path);
    let p2 = p.clone();
    let info = tokio::task::spawn_blocking(move || depot::inspect(&p2)).await.map_err(|e| AppError::msg(e.to_string()))??;
    let file_path = cloud::upload_depot(&state.http, &state.paths.root, &p, &info.file_name).await?;
    Ok(Uploaded { file_path, file_name: info.file_name, file_size: info.size, sha256: info.sha256, kind: info.kind })
}

/// Depo dosyasını depolamadan siler (kayıt silinince arayüz çağırır)
#[tauri::command]
pub async fn depot_delete_file(state: State<'_, AppState>, file_path: String) -> Result<()> {
    cloud::delete_depot(&state.http, &state.paths.root, &file_path).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotInstall {
    pub installed: Installed,
    pub warnings: Vec<String>,
    /// Modpack yeni bir instance olarak kurulduysa onun kimliği
    pub instance_id: Option<String>,
    /// Bir önceki sürüm kaldırılıp yerine bu kurulduysa önceki sürüm
    pub replaced: Option<String>,
}

/// Bir instance'a Depo'dan kurulanlar (güncelleme için): instance klasöründe depot.json
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotRecord {
    pub version: String,
    pub version_id: Option<String>,
    pub sha256: String,
    pub kind: String,
    /// Oyun klasörüne göre yol ("mods/örnek.jar")
    pub place: String,
    pub at: String,
}

fn records_file(state: &AppState, instance_id: &str) -> std::path::PathBuf {
    state.paths.instance_dir(instance_id).join("depot.json")
}

fn load_records(state: &AppState, instance_id: &str) -> std::collections::BTreeMap<String, DepotRecord> {
    std::fs::read(records_file(state, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Bu instance'a Depo'dan kurulanlar: öğe kimliği → kurulu sürüm. Dosyası silinmiş olanlar çıkarılır.
#[tauri::command]
pub fn depot_installed(state: State<'_, AppState>, instance_id: String) -> std::collections::BTreeMap<String, DepotRecord> {
    let game = state.paths.instance_game_dir(&instance_id);
    let mut r = load_records(&state, &instance_id);
    r.retain(|_, v| crate::content::safe_rel(&v.place).is_some_and(|p| game.join(p).exists()));
    r
}

/// Depo öğesini (ya da belirli bir sürümünü) indirir, özetini doğrular ve türüne göre kurar:
/// modlar/paketler seçilen instance'a (aynı öğenin eski sürümü kaldırılarak), modpack'ler yeni bir
/// instance olarak; diğerleri İndirilenler klasörüne. Öğe bilgisi arayüzden değil Supabase'ten okunur.
#[tauri::command]
pub async fn depot_install(app: AppHandle, state: State<'_, AppState>, item_id: String, instance_id: Option<String>, world: Option<String>, version_id: Option<String>) -> Result<DepotInstall> {
    if uuid::Uuid::parse_str(&item_id).is_err() || version_id.as_deref().is_some_and(|v| uuid::Uuid::parse_str(v).is_err()) {
        return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
    }
    let get = |table: &'static str, q: Vec<(String, String)>| {
        let st = &state;
        async move { cloud::api(&st.http, &st.paths.root, "GET", table, &q, None, None).await }
    };
    let item = get("/rest/v1/depot_items", vec![("id".into(), format!("eq.{item_id}")), ("select".into(), "kind,title,version,file_path,file_name,file_size,sha256,mc_versions,loaders".into())]).await?;
    let item = item.as_array().and_then(|a| a.first()).cloned().ok_or_else(|| AppError::msg(crate::i18n::t("Dosya bulunamadı ya da kaldırılmış")))?;
    // Belirli bir sürüm istendiyse onun dosyası
    let it = match &version_id {
        Some(v) => {
            let r = get("/rest/v1/depot_versions", vec![("id".into(), format!("eq.{v}")), ("item_id".into(), format!("eq.{item_id}")), ("select".into(), "version,file_path,file_name,file_size,sha256,mc_versions,loaders".into())]).await?;
            r.as_array().and_then(|a| a.first()).cloned().ok_or_else(|| AppError::msg(crate::i18n::t("Sürüm bulunamadı")))?
        }
        None => item.clone(),
    };
    let s = |v: &serde_json::Value, k: &str| v[k].as_str().unwrap_or_default().to_string();
    let (kind, title) = (s(&item, "kind"), s(&item, "title"));
    let (version, file_path, file_name, sha) = (s(&it, "version"), s(&it, "file_path"), s(&it, "file_name"), s(&it, "sha256").to_lowercase());
    let size = it["file_size"].as_u64().unwrap_or(0);
    let list = |k: &str| it[k].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>()).unwrap_or_default();
    let (mcs, loaders) = (list("mc_versions"), list("loaders"));
    if size == 0 || size > depot::MAX_SIZE || sha.len() != 64 {
        return Err(AppError::msg(crate::i18n::t("Dosya kaydı geçersiz")));
    }

    // Instance uygunluğu (modpack kendi instance'ını oluşturur)
    let mut warnings = vec![];
    let target = if kind == "modpack" { None } else { instance_id.clone() };
    let game_dir = match &target {
        Some(id) => {
            if state.running.lock().contains_key(id) || state.hunts.lock().contains_key(id) {
                return Err(AppError::msg(crate::i18n::t("Oyun açıkken bu işlem yapılamaz; önce oyunu kapat")));
            }
            let inst = InstanceManager::new(&state.paths).get(id)?;
            if kind == "mod" {
                let l = loader_slug(inst.loader.kind).ok_or_else(|| AppError::msg(crate::i18n::t("Vanilla bir instance'a mod kurulamaz; Fabric, Quilt, Forge veya NeoForge instance'ı seçin")))?;
                let ok = loaders.is_empty() || loaders.contains(&l) || (l == "quilt" && loaders.iter().any(|x| x == "fabric"));
                if !ok {
                    return Err(AppError::msg(crate::i18n::tf("Bu mod {0} içindir; bu instance {1} kullanıyor.", &[&loaders.join(", "), &l])));
                }
            }
            if !mcs.is_empty() && !mcs.iter().any(|v| inst.mc_version.starts_with(v.as_str()) || v.starts_with(&inst.mc_version)) {
                warnings.push(crate::i18n::tf("Paylaşan bunu {0} için belirtmiş; bu instance {1}. Çalışmayabilir.", &[&mcs.join(", "), &inst.mc_version]));
            }
            Some(state.paths.instance_game_dir(id))
        }
        None => None,
    };

    // İndir (en fazla kayıttaki boyut kadar), özeti doğrula
    let task = target.clone().unwrap_or_else(|| format!("depot-{item_id}"));
    let progress = progress_emitter(&app);
    report(&progress, &task, "depot", 0, size);
    let url = cloud::depot_url(&file_path)?;
    let tmp_dir = state.paths.cache().join("depot");
    tokio::fs::create_dir_all(&tmp_dir).await?;
    let tmp = tmp_dir.join(format!("{}.part", uuid::Uuid::new_v4()));
    let res: Result<()> = async {
        let resp = state.http.client.get(&url).send().await?.error_for_status()?;
        let mut body = resp.bytes_stream();
        let mut f = tokio::fs::File::create(&tmp).await?;
        let mut h = Sha256::new();
        let mut got = 0u64;
        while let Some(chunk) = body.next().await {
            let chunk = chunk?;
            got += chunk.len() as u64;
            if got > size {
                return Err(AppError::msg(crate::i18n::t("İndirilen dosya kayıttakinden büyük; kurulmadı.")));
            }
            h.update(&chunk);
            f.write_all(&chunk).await?;
            report(&progress, &task, "depot", got, size);
        }
        f.flush().await?;
        if got != size || hex::encode(h.finalize()) != sha {
            return Err(AppError::msg(crate::i18n::t("Dosyanın özeti yüklenen dosyayla uyuşmuyor (değiştirilmiş ya da bozuk); kurulmadı.")));
        }
        Ok(())
    }
    .await;
    if let Err(e) = res {
        let _ = tokio::fs::remove_file(&tmp).await;
        report(&progress, &task, "done", 1, 1);
        return Err(e);
    }

    // Modpack: yeni instance olarak kur (dosyalar yalnızca Modrinth'in izin verdiği adreslerden)
    if kind == "modpack" {
        let ctx = crate::content::modpack::PackCtx {
            http: &state.http,
            paths: &state.paths,
            cf_key: None,
            concurrency: state.settings.read().max_concurrent_downloads,
            progress: progress.clone(),
        };
        let r = crate::content::modpack::install_archive(&ctx, &tmp, &title, &task, true).await;
        let _ = tokio::fs::remove_file(&tmp).await;
        report(&progress, &task, "done", 1, 1);
        let inst = r?;
        let _ = cloud::api(&state.http, &state.paths.root, "POST", "/rest/v1/rpc/depot_count_download", &[], Some(serde_json::json!({ "p_item": item_id })), None).await;
        tracing::info!("Depo: modpack \"{title}\" yeni instance olarak kuruldu → {}", inst.name);
        let dir = state.paths.instance_dir(&inst.id).display().to_string();
        return Ok(DepotInstall { installed: Installed { path: dir, place: inst.name.clone() }, warnings, instance_id: Some(inst.id), replaced: None });
    }

    // Aynı öğenin bu instance'taki eski sürümü kaldırılır (dünyalar oyuncu verisi olduğu için kalır)
    let mut records = target.as_deref().map(|id| load_records(&state, id)).unwrap_or_default();
    let mut replaced = None;
    if let (Some(game), Some(old)) = (&game_dir, records.get(&item_id)) {
        if matches!(kind.as_str(), "mod" | "resourcepack" | "shader" | "schematic") {
            if let Some(rel) = crate::content::safe_rel(&old.place) {
                let p = game.join(rel);
                if p.is_file() {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
        replaced = Some(old.version.clone());
    }

    let (k, n, w, t2, g2) = (kind.clone(), file_name.clone(), world.clone(), tmp.clone(), game_dir.clone());
    let placed = tokio::task::spawn_blocking(move || depot::place(&t2, &n, &k, g2.as_deref(), w.as_deref())).await.map_err(|e| AppError::msg(e.to_string()))?;
    let _ = tokio::fs::remove_file(&tmp).await;
    report(&progress, &task, "done", 1, 1);
    let installed = placed?;
    if let Some(id) = &target {
        records.insert(item_id.clone(), DepotRecord { version: version.clone(), version_id: version_id.clone(), sha256: sha.clone(), kind: kind.clone(), place: installed.place.clone(), at: chrono::Utc::now().to_rfc3339() });
        let _ = crate::util::write_json_atomic(&records_file(&state, id), &records);
    }
    let _ = cloud::api(&state.http, &state.paths.root, "POST", "/rest/v1/rpc/depot_count_download", &[], Some(serde_json::json!({ "p_item": item_id })), None).await;
    tracing::info!("Depo: \"{title}\" {version} kuruldu → {}", installed.place);
    Ok(DepotInstall { installed, warnings, instance_id: None, replaced })
}
