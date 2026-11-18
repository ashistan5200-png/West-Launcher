//! İzole instance (profil) yönetimi: oluşturma, klonlama, şablon, silme.

pub mod loaders;
pub mod modes;

use crate::error::{AppError, Result};
use crate::paths::Paths;
use crate::util::{copy_dir_filtered, slugify, write_json_atomic};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum LoaderKind {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loader {
    pub kind: LoaderKind,
    /// Vanilla için None
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    /// Özel banner görseli (instance klasöründe); yoksa prosedürel manzara
    #[serde(default)]
    pub banner: Option<String>,
    /// Prosedürel manzaranın tohumu ("Manzarayı değiştir")
    #[serde(default)]
    pub cover_seed: Option<String>,
    pub group: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    /// Kurulumdan sonra çözülen başlatılabilir sürüm kimliği (örn. "fabric-loader-0.16.9-1.21.1")
    pub version_id: Option<String>,
    pub java_path: Option<String>,
    pub memory_mb: Option<u32>,
    #[serde(default)]
    pub extra_jvm_args: Vec<String>,
    pub resolution: Option<(u32, u32)>,
    #[serde(default)]
    pub is_template: bool,
    pub created: DateTime<Utc>,
    pub last_played: Option<DateTime<Utc>>,
    #[serde(default)]
    pub total_play_secs: u64,
    /// İçe aktarıldıysa kaynak launcher ("prism", "curseforge" …)
    pub imported_from: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewInstance {
    pub name: String,
    pub mc_version: String,
    pub loader: Loader,
    pub icon: Option<String>,
    pub group: Option<String>,
}

/// Klonlama/şablonda taşınmayan, oyuncuya özgü veya geçici klasörler.
const VOLATILE: &[&str] = &["logs", "crash-reports", ".fabric", ".mixin.out", "natives"];

pub struct InstanceManager<'a> {
    paths: &'a Paths,
}

impl<'a> InstanceManager<'a> {
    pub fn new(paths: &'a Paths) -> Self {
        Self { paths }
    }

    fn meta_file(&self, id: &str) -> std::path::PathBuf {
        self.paths.instance_dir(id).join("instance.json")
    }

    pub fn list(&self) -> Result<Vec<Instance>> {
        let mut out = Vec::new();
        let Ok(rd) = std::fs::read_dir(self.paths.instances()) else { return Ok(out) };
        for entry in rd.flatten() {
            let f = entry.path().join("instance.json");
            if let Ok(bytes) = std::fs::read(&f) {
                match serde_json::from_slice::<Instance>(&bytes) {
                    Ok(i) => out.push(i),
                    Err(e) => tracing::warn!("bozuk instance.json {}: {e}", f.display()),
                }
            }
        }
        out.sort_by(|a, b| b.last_played.cmp(&a.last_played).then(a.name.cmp(&b.name)));
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Instance> {
        let bytes = std::fs::read(self.meta_file(id)).map_err(|_| AppError::NotFound(format!("instance {id}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn save(&self, inst: &Instance) -> Result<()> {
        write_json_atomic(&self.meta_file(&inst.id), inst)
    }

    fn unique_id(&self, name: &str) -> String {
        let base = slugify(name);
        let mut id = base.clone();
        let mut n = 2;
        while self.paths.instance_dir(&id).exists() {
            id = format!("{base}-{n}");
            n += 1;
        }
        id
    }

    pub fn create(&self, req: NewInstance) -> Result<Instance> {
        let id = self.unique_id(&req.name);
        let game = self.paths.instance_game_dir(&id);
        for sub in ["mods", "config", "resourcepacks", "shaderpacks", "saves", "screenshots"] {
            std::fs::create_dir_all(game.join(sub))?;
        }
        let inst = Instance {
            id,
            name: req.name,
            icon: req.icon,
            banner: None,
            cover_seed: None,
            group: req.group,
            mc_version: req.mc_version,
            loader: req.loader,
            version_id: None,
            java_path: None,
            memory_mb: None,
            extra_jvm_args: vec![],
            resolution: None,
            is_template: false,
            created: Utc::now(),
            last_played: None,
            total_play_secs: 0,
            imported_from: None,
        };
        self.save(&inst)?;
        Ok(inst)
    }

    /// Tam kopya. `include_worlds=false` ise dünyalar hariç tutulur.
    pub fn clone_instance(&self, id: &str, new_name: &str, include_worlds: bool) -> Result<Instance> {
        let src = self.get(id)?;
        let new_id = self.unique_id(new_name);
        let mut skip: Vec<&str> = VOLATILE.to_vec();
        if !include_worlds {
            skip.push("saves");
        }
        copy_dir_filtered(&self.paths.instance_game_dir(id), &self.paths.instance_game_dir(&new_id), &skip)?;
        let inst = Instance {
            id: new_id,
            name: new_name.to_string(),
            is_template: false,
            created: Utc::now(),
            last_played: None,
            total_play_secs: 0,
            ..src
        };
        std::fs::create_dir_all(self.paths.instance_game_dir(&inst.id).join("saves"))?;
        self.save(&inst)?;
        Ok(inst)
    }

    /// Şablon = dünyasız, yalnızca mod/config/ayar içeren klon; listede ayrı gösterilir.
    pub fn make_template(&self, id: &str, name: &str) -> Result<Instance> {
        let mut t = self.clone_instance(id, name, false)?;
        t.is_template = true;
        self.save(&t)?;
        Ok(t)
    }

    pub fn from_template(&self, template_id: &str, name: &str) -> Result<Instance> {
        self.clone_instance(template_id, name, false)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let dir = self.paths.instance_dir(id);
        if !dir.starts_with(self.paths.instances()) || id.is_empty() || id.contains("..") {
            return Err(AppError::msg(crate::i18n::t("Geçersiz instance kimliği")));
        }
        std::fs::remove_dir_all(dir)?;
        Ok(())
    }

    pub fn mod_count(&self, id: &str) -> usize {
        std::fs::read_dir(self.paths.instance_game_dir(id).join("mods"))
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.path().extension().map(|x| x == "jar").unwrap_or(false))
                    .count()
            })
            .unwrap_or(0)
    }

    pub fn record_session(&self, id: &str, secs: u64) -> Result<()> {
        let mut i = self.get(id)?;
        i.last_played = Some(Utc::now());
        i.total_play_secs += secs;
        self.save(&i)
    }
}
