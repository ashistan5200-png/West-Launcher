use crate::util::{os_arch, os_name};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub action: String,
    #[serde(default)]
    pub os: Option<OsRule>,
    #[serde(default)]
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsRule {
    pub name: Option<String>,
    pub arch: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Features {
    pub is_demo_user: bool,
    pub has_custom_resolution: bool,
}

impl Features {
    fn get(&self, key: &str) -> bool {
        match key {
            "is_demo_user" => self.is_demo_user,
            "has_custom_resolution" => self.has_custom_resolution,
            _ => false, // quick play vb. desteklenmeyen özellikler kapalı
        }
    }
}

fn os_matches(os: &OsRule) -> bool {
    if let Some(name) = &os.name {
        if name != os_name() {
            return false;
        }
    }
    if let Some(arch) = &os.arch {
        let ours = os_arch();
        let ok = arch == ours || (arch == "x86" && ours == "x86");
        if !ok {
            return false;
        }
    }
    true
}

/// Mojang kural semantiği: kural varsa varsayılan "izin yok"; eşleşen her
/// kural sonucu kendi action'ına çevirir (son eşleşen kazanır).
pub fn allowed(rules: &Option<Vec<Rule>>, features: &Features) -> bool {
    let Some(rules) = rules else { return true };
    if rules.is_empty() {
        return true;
    }
    let mut result = false;
    for rule in rules {
        let mut matches = true;
        if let Some(os) = &rule.os {
            matches &= os_matches(os);
        }
        if let Some(fs) = &rule.features {
            matches &= fs.iter().all(|(k, v)| features.get(k) == *v);
        }
        if matches {
            result = rule.action == "allow";
        }
    }
    result
}
