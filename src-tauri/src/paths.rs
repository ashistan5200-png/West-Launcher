use std::path::{Path, PathBuf};

/// Launcher veri düzeni. `meta/` klasörü bilinçli olarak `.minecraft` ile aynı
/// yapıdadır (versions/, libraries/, assets/) — böylece Forge/NeoForge
/// kurulumcuları doğrudan buraya kurulum yapabilir ve tüm instance'lar
/// kütüphaneleri paylaşır (disk tasarrufu), oyun dizinleri ise tamamen izoledir.
#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn default_root() -> PathBuf {
        let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
        let root = base.join("WestLauncher");
        // Eski "ShardLauncher" geliştirme verisini bir kereliğine taşı
        let legacy = base.join("ShardLauncher");
        if !root.exists() && legacy.exists() {
            let _ = std::fs::rename(&legacy, &root);
        }
        root
    }

    pub fn ensure(&self) -> std::io::Result<()> {
        for d in [
            self.instances(),
            self.versions(),
            self.libraries(),
            self.assets().join("indexes"),
            self.assets().join("objects"),
            self.java_runtimes(),
            self.backups(),
            self.cache(),
        ] {
            std::fs::create_dir_all(d)?;
        }
        Ok(())
    }

    pub fn meta(&self) -> PathBuf { self.root.join("meta") }
    pub fn versions(&self) -> PathBuf { self.meta().join("versions") }
    pub fn libraries(&self) -> PathBuf { self.meta().join("libraries") }
    pub fn assets(&self) -> PathBuf { self.meta().join("assets") }
    pub fn instances(&self) -> PathBuf { self.root.join("instances") }
    pub fn java_runtimes(&self) -> PathBuf { self.root.join("java") }
    pub fn backups(&self) -> PathBuf { self.root.join("backups") }
    pub fn cache(&self) -> PathBuf { self.root.join("cache") }
    pub fn settings_file(&self) -> PathBuf { self.root.join("settings.json") }
    pub fn accounts_file(&self) -> PathBuf { self.root.join("accounts.json") }

    pub fn version_json(&self, id: &str) -> PathBuf {
        self.versions().join(id).join(format!("{id}.json"))
    }
    pub fn version_jar(&self, id: &str) -> PathBuf {
        self.versions().join(id).join(format!("{id}.jar"))
    }
    pub fn instance_dir(&self, id: &str) -> PathBuf { self.instances().join(id) }
    pub fn instance_game_dir(&self, id: &str) -> PathBuf { self.instance_dir(id).join("minecraft") }
    pub fn instance_natives(&self, id: &str) -> PathBuf { self.instance_dir(id).join("natives") }
}

/// Maven koordinatını (`group:artifact:version[:classifier][@ext]`) göreli yola çevirir.
pub fn maven_path(name: &str) -> Option<PathBuf> {
    let (coords, ext) = match name.split_once('@') {
        Some((c, e)) => (c, e),
        None => (name, "jar"),
    };
    let parts: Vec<&str> = coords.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let (group, artifact, version) = (parts[0], parts[1], parts[2]);
    let file = match parts.get(3) {
        Some(cls) => format!("{artifact}-{version}-{cls}.{ext}"),
        None => format!("{artifact}-{version}.{ext}"),
    };
    let mut p = PathBuf::new();
    for g in group.split('.') {
        p.push(g);
    }
    p.push(artifact);
    p.push(version);
    p.push(file);
    Some(p)
}

pub fn path_to_url_segment(p: &Path) -> String {
    p.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maven() {
        assert_eq!(
            path_to_url_segment(&maven_path("net.fabricmc:fabric-loader:0.16.9").unwrap()),
            "net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar"
        );
        assert_eq!(
            path_to_url_segment(&maven_path("org.lwjgl:lwjgl:3.3.3:natives-linux").unwrap()),
            "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar"
        );
        assert_eq!(
            path_to_url_segment(&maven_path("de.oceanlabs.mcp:mcp_config:1.20.1@zip").unwrap()),
            "de/oceanlabs/mcp/mcp_config/1.20.1/mcp_config-1.20.1.zip"
        );
    }
}
