//! Oyun modları ("Build modu", "PvP modu" …): her mod, hangi modların/paketlerin açık
//! olacağını ve isteğe bağlı olarak options.txt'nin (tuş atamaları, hassasiyet, FOV…)
//! bir kopyasını saklar. Moda geçince içerikler açılıp kapanır ve ayarlar geri yüklenir.
//!
//! Moddan çıkarken o anki options.txt aktif modun kopyasına yazılır; böylece oyunda
//! değiştirilen tuşlar kaybolmaz. Mod oluşturulduktan sonra eklenen içeriklere dokunulmaz.

use crate::content::manage::{resolve, set_enabled, FOLDERS};
use crate::error::{AppError, Result};
use crate::util::write_json_atomic;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const DISABLED: &str = ".disabled";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMode {
    pub id: String,
    pub name: String,
    pub icon: String,
    /// Bu modda açık olacak içerikler ("mods/sodium.jar")
    pub enabled: Vec<String>,
    /// Bu modda kapalı olacak içerikler
    pub disabled: Vec<String>,
    /// options.txt kopyası var mı (tuş atamaları dahil)
    pub has_options: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Modes {
    pub modes: Vec<GameMode>,
    pub active: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub enabled: usize,
    pub disabled: usize,
    pub options_restored: bool,
    /// Moddan sonra silinmiş, bu yüzden atlanan içerikler
    pub missing: usize,
}

fn file(instance_dir: &Path) -> PathBuf {
    instance_dir.join("modes.json")
}

fn snapshot(instance_dir: &Path, id: &str) -> PathBuf {
    instance_dir.join("modes").join(format!("{id}.options.txt"))
}

pub fn load(instance_dir: &Path) -> Modes {
    std::fs::read(file(instance_dir)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(instance_dir: &Path, m: &Modes) -> Result<()> {
    write_json_atomic(&file(instance_dir), m)
}

/// Şu anki içerik durumunu okur: (açık, kapalı) kimlik listeleri.
fn current_state(game_dir: &Path) -> (Vec<String>, Vec<String>) {
    let (mut on, mut off) = (vec![], vec![]);
    for (folder, _) in FOLDERS {
        let Ok(rd) = std::fs::read_dir(game_dir.join(folder)) else { continue };
        for e in rd.flatten() {
            if !e.path().is_file() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let base = name.trim_end_matches(DISABLED);
            if !(base.ends_with(".jar") || base.ends_with(".zip")) {
                continue;
            }
            let id = format!("{folder}/{base}");
            if name.ends_with(DISABLED) { off.push(id) } else { on.push(id) }
        }
    }
    on.sort();
    off.sort();
    (on, off)
}

/// Şu anki durumu yeni bir mod olarak kaydeder ya da `id` verilirse o modu günceller.
pub fn capture(instance_dir: &Path, game_dir: &Path, id: Option<&str>, name: &str, icon: &str, include_options: bool) -> Result<GameMode> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 32 {
        return Err(AppError::msg(crate::i18n::t("Mod adı 1–32 karakter olmalı")));
    }
    let mut m = load(instance_dir);
    let (enabled, disabled) = current_state(game_dir);
    let id = id.map(String::from).unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string()[..12].to_string());
    let opts = game_dir.join("options.txt");
    let snap = snapshot(instance_dir, &id);
    let has_options = include_options && opts.is_file();
    if has_options {
        std::fs::create_dir_all(snap.parent().unwrap())?;
        std::fs::copy(&opts, &snap)?;
    } else {
        let _ = std::fs::remove_file(&snap);
    }
    let mode = GameMode { id: id.clone(), name: name.to_string(), icon: icon.chars().take(4).collect(), enabled, disabled, has_options };
    match m.modes.iter_mut().find(|x| x.id == id) {
        Some(x) => *x = mode.clone(),
        None => {
            if m.modes.len() >= 12 {
                return Err(AppError::msg(crate::i18n::t("En fazla 12 mod oluşturulabilir")));
            }
            m.modes.push(mode.clone());
        }
    }
    // Kaydedilen durum zaten şu anki durum → bu mod aktif sayılır
    m.active = Some(id);
    save(instance_dir, &m)?;
    Ok(mode)
}

/// Moda geçer: içerikleri açar/kapatır ve options.txt'yi geri yükler.
pub fn apply(instance_dir: &Path, game_dir: &Path, id: &str) -> Result<ApplyReport> {
    let mut m = load(instance_dir);
    let mode = m.modes.iter().find(|x| x.id == id).cloned().ok_or_else(|| AppError::msg(crate::i18n::t("Mod bulunamadı")))?;
    let opts = game_dir.join("options.txt");

    // Çıkılan modun tuş atamalarını koru
    if let Some(prev) = m.active.clone().filter(|p| p != id) {
        if m.modes.iter().any(|x| x.id == prev && x.has_options) && opts.is_file() {
            let _ = std::fs::copy(&opts, snapshot(instance_dir, &prev));
        }
    }

    let exists = |ids: &[String]| -> (Vec<String>, usize) {
        let ok: Vec<String> = ids.iter().filter(|i| resolve(game_dir, i).is_ok()).cloned().collect();
        let missing = ids.len() - ok.len();
        (ok, missing)
    };
    let (on, miss_a) = exists(&mode.enabled);
    let (off, miss_b) = exists(&mode.disabled);
    set_enabled(game_dir, &on, true)?;
    set_enabled(game_dir, &off, false)?;

    let snap = snapshot(instance_dir, id);
    let options_restored = mode.has_options && snap.is_file() && std::fs::copy(&snap, &opts).is_ok();
    m.active = Some(id.to_string());
    save(instance_dir, &m)?;
    Ok(ApplyReport { enabled: on.len(), disabled: off.len(), options_restored, missing: miss_a + miss_b })
}

pub fn delete(instance_dir: &Path, id: &str) -> Result<()> {
    let mut m = load(instance_dir);
    m.modes.retain(|x| x.id != id);
    if m.active.as_deref() == Some(id) {
        m.active = None;
    }
    let _ = std::fs::remove_file(snapshot(instance_dir, id));
    save(instance_dir, &m)
}

pub fn rename(instance_dir: &Path, id: &str, name: &str, icon: &str) -> Result<()> {
    let mut m = load(instance_dir);
    let x = m.modes.iter_mut().find(|x| x.id == id).ok_or_else(|| AppError::msg(crate::i18n::t("Mod bulunamadı")))?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 32 {
        return Err(AppError::msg(crate::i18n::t("Mod adı 1–32 karakter olmalı")));
    }
    x.name = name.to_string();
    x.icon = icon.chars().take(4).collect();
    save(instance_dir, &m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(p: PathBuf) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, b"x").unwrap();
    }

    #[test]
    fn build_and_pvp_modes_swap_mods_and_keybinds() {
        let root = std::env::temp_dir().join(format!("west-modes-{}", uuid::Uuid::new_v4()));
        let (inst, game) = (root.join("inst"), root.join("inst/minecraft"));
        touch(game.join("mods/axiom.jar"));
        touch(game.join("mods/sodium.jar"));
        touch(game.join("mods/pvp-hud.jar.disabled"));
        std::fs::write(game.join("options.txt"), "key_key.attack:key.mouse.left\nkey_axiom:key.keyboard.b\n").unwrap();

        let build = capture(&inst, &game, None, "Build", "🏗️", true).unwrap();

        // PvP düzeni: axiom kapalı, pvp-hud açık, farklı tuşlar
        set_enabled(&game, &["mods/axiom.jar".into()], false).unwrap();
        set_enabled(&game, &["mods/pvp-hud.jar".into()], true).unwrap();
        std::fs::write(game.join("options.txt"), "key_key.attack:key.mouse.left\nkey_key.drop:key.keyboard.x\n").unwrap();
        let pvp = capture(&inst, &game, None, "PvP", "⚔️", true).unwrap();

        // Sonradan eklenen mod iki modda da yok → dokunulmamalı
        touch(game.join("mods/new.jar"));

        let r = apply(&inst, &game, &build.id).unwrap();
        assert!(r.options_restored);
        assert!(game.join("mods/axiom.jar").exists());
        assert!(game.join("mods/pvp-hud.jar.disabled").exists());
        assert!(game.join("mods/new.jar").exists());
        assert!(std::fs::read_to_string(game.join("options.txt")).unwrap().contains("key_axiom"));

        // Build'deyken oyunda tuş değişti → PvP'ye geçince Build'in kopyasına kaydedilmeli
        std::fs::write(game.join("options.txt"), "key_axiom:key.keyboard.n\n").unwrap();
        apply(&inst, &game, &pvp.id).unwrap();
        assert!(game.join("mods/axiom.jar.disabled").exists());
        assert!(game.join("mods/pvp-hud.jar").exists());
        assert!(std::fs::read_to_string(game.join("options.txt")).unwrap().contains("key.drop"));
        apply(&inst, &game, &build.id).unwrap();
        assert_eq!(std::fs::read_to_string(game.join("options.txt")).unwrap(), "key_axiom:key.keyboard.n\n");

        // Silinen içerik atlanır
        std::fs::remove_file(game.join("mods/sodium.jar")).unwrap();
        assert_eq!(apply(&inst, &game, &pvp.id).unwrap().missing, 1);

        delete(&inst, &build.id).unwrap();
        assert_eq!(load(&inst).modes.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
