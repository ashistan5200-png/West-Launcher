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
}

/// Depo öğesini indirir, özetini doğrular ve türüne göre seçilen instance'a kurar (instance yoksa
/// İndirilenler klasörüne kaydeder). Öğe bilgisi arayüzden değil, doğrudan Supabase'ten okunur.
#[tauri::command]
pub async fn depot_install(app: AppHandle, state: State<'_, AppState>, item_id: String, instance_id: Option<String>, world: Option<String>) -> Result<DepotInstall> {
    if uuid::Uuid::parse_str(&item_id).is_err() {
        return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
    }
    let rows = cloud::api(
        &state.http,
        &state.paths.root,
        "GET",
        "/rest/v1/depot_items",
        &[("id".into(), format!("eq.{item_id}")), ("select".into(), "kind,title,file_path,file_name,file_size,sha256,mc_versions,loaders,removed".into())],
        None,
        None,
    )
    .await?;
    let it = rows.as_array().and_then(|a| a.first()).cloned().ok_or_else(|| AppError::msg(crate::i18n::t("Dosya bulunamadı ya da kaldırılmış")))?;
    let s = |k: &str| it[k].as_str().unwrap_or_default().to_string();
    let (kind, title, file_path, file_name, sha) = (s("kind"), s("title"), s("file_path"), s("file_name"), s("sha256").to_lowercase());
    let size = it["file_size"].as_u64().unwrap_or(0);
    let list = |k: &str| it[k].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>()).unwrap_or_default();
    let (mcs, loaders) = (list("mc_versions"), list("loaders"));
    if size == 0 || size > depot::MAX_SIZE || sha.len() != 64 {
        return Err(AppError::msg(crate::i18n::t("Dosya kaydı geçersiz")));
    }

    // Instance uygunluğu
    let mut warnings = vec![];
    let game_dir = match &instance_id {
        Some(id) => {
            if state.running.lock().contains_key(id) || state.hunts.lock().contains_key(id) {
                return Err(AppError::msg(crate::i18n::t("Oyun açıkken bu işlem yapılamaz; önce oyunu kapat")));
            }
            let inst = InstanceManager::new(&state.paths).get(id)?;
            if kind == "mod" {
                let l = loader_slug(inst.loader.kind).ok_or_else(|| AppError::msg(crate::i18n::t("Vanilla bir instance'a mod kurulamaz; Fabric, Quilt, Forge veya NeoForge instance'ı seçin")))?;
                // Quilt, Fabric modlarını da çalıştırır
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
    let task = instance_id.clone().unwrap_or_else(|| format!("depot-{item_id}"));
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

    let (k, n, w, t2) = (kind.clone(), file_name.clone(), world.clone(), tmp.clone());
    let placed = tokio::task::spawn_blocking(move || depot::place(&t2, &n, &k, game_dir.as_deref(), w.as_deref())).await.map_err(|e| AppError::msg(e.to_string()))?;
    let _ = tokio::fs::remove_file(&tmp).await;
    report(&progress, &task, "done", 1, 1);
    let installed = placed?;
    // İndirme sayacı (kişi başı bir kez)
    let _ = cloud::api(&state.http, &state.paths.root, "POST", "/rest/v1/rpc/depot_count_download", &[], Some(serde_json::json!({ "p_item": item_id })), None).await;
    tracing::info!("Depo: \"{title}\" kuruldu → {}", installed.place);
    Ok(DepotInstall { installed, warnings })
}
