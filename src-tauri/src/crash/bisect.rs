//! Ashi'nin Otomatik Suçlu Avcısı — bağımlılık farkındalıklı ikili arama.
//!
//! Varsayım: çökme, belirli bir mod kümesi C etkin olduğunda oluşur.
//! Her turda şüphelilerin yarısı (H) ve H'nin zorunlu bağımlılık kapanışı
//! etkinleştirilir (E = closure(H)), geri kalan her şey kapatılır:
//!   - çöktü   → şüpheliler ∩= E
//!   - çökmedi → şüpheliler −= E
//! Tek şüpheli kalınca bir doğrulama turu koşulur. Çökme iki modun
//! birlikteliğinden doğuyorsa doğrulama bunu yakalar ve dürüstçe "kombinasyon"
//! sonucu döner. İlk tur (baseline) çökmenin tekrar edip etmediğini kontrol eder;
//! etmiyorsa boşa 8 tur harcanmaz.

use super::modinfo::ModInfo;
use crate::error::Result;
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::path::Path;

/// Av sırasında geçici olarak kapatılan modların uzantısı.
/// Kullanıcının kendi `.disabled` dosyalarından ayrıdır; açılışta otomatik geri alınır.
pub const OFF_SUFFIX: &str = ".ashi-off";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Baseline,
    /// Yalnızca kütüphaneler açık: sorun kütüphanelerde mi?
    Libraries,
    Hunting,
    Verify,
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Verdict {
    /// Tek başına (bağımlılıklarıyla) çökmeyi üreten mod(lar)
    Culprit { mods: Vec<usize> },
    /// Çökme yalnızca birden fazla modun birlikteliğinde oluşuyor
    Combination { suspects: Vec<usize> },
    /// Tüm modlar açıkken bile çökme tekrarlanmadı
    NotReproduced,
}

/// Bir denemenin sonucu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Res {
    /// Oyun ana menüye ulaştı
    Ok,
    /// İlk çökmeyle aynı hata
    Crash,
    /// Başka bir hata (çoğunlukla kapatılan bir moda gizli bağımlılık) → sonuç belirsiz
    Other,
}

#[derive(Debug, Clone)]
pub struct Test {
    pub phase: Phase,
    pub enabled: BTreeSet<usize>,
}

/// Kütüphane/çekirdek modlar: av sırasında asla tek başına kapatılmaz.
const KNOWN_LIBS: &[&str] = &[
    "fabric-api", "fabric", "fabric-language-kotlin", "fabric_language_kotlin", "fabric-language-scala", "quilted_fabric_api", "qsl",
    "cloth-config", "cloth_config", "cloth-config2", "architectury", "geckolib", "owo", "owo-lib", "yet_another_config_lib_v3", "yacl",
    "forgeconfigapiport", "kotlinforforge", "balm", "bookshelf", "puzzleslib", "collective", "moonlight", "resourcefullib", "creativecore",
    "citadel", "curios", "trinkets", "cardinal-components", "cardinal-components-base", "playeranimator", "player-animator", "midnightlib",
    "konkrete", "iceberg", "framework", "terrablender", "lithostitched", "cristellib", "supermartijn642corelib", "supermartijn642configlib",
    "libipn", "fzzy_config", "silk", "azurelib", "polymer", "placeholder-api", "sodium", "indium", "satin", "lambdynlights_api", "modmenu",
    "fabricloader", "java", "minecraft", "neoforge", "forge", "jei", "rei", "emi", "kotlin", "mixinextras", "mixinsquared",
];

pub fn is_library(m: &ModInfo, dependents: usize) -> bool {
    static LIBISH: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"(?i)(^|[-_ ])(lib|libs|library|api|core|config|kotlin|scala|language|loader)([-_ ]|$)|lib$|api$").unwrap());
    if m.provides.iter().any(|id| KNOWN_LIBS.contains(&id.as_str())) {
        return true;
    }
    if m.provides.iter().any(|id| LIBISH.is_match(id)) || LIBISH.is_match(&m.name) {
        return true;
    }
    // Birden fazla mod buna bağlıysa pratikte bir kütüphanedir
    dependents >= 2
}

pub struct Planner {
    deps: Vec<BTreeSet<usize>>,
    all: BTreeSet<usize>,
    /// Kütüphaneler
    libs: BTreeSet<usize>,
    /// Her denemede açık tutulanlar (kütüphaneler + gizli bağımlılık olarak bulunanlar)
    always: BTreeSet<usize>,
    suspects: BTreeSet<usize>,
    last_nonempty: BTreeSet<usize>,
    phase: Phase,
    pending: Option<Test>,
    verdict: Option<Verdict>,
    /// Bir önceki deneme belirsiz çıktıysa öteki yarıyı dene
    flip: bool,
    others_in_row: u8,
    pub round: u32,
    /// Belirsiz (farklı hatayla biten) deneme sayısı
    pub inconclusive: u32,
}

impl Planner {
    pub fn new(mods: &[ModInfo]) -> Self {
        // Aynı kimliği birden çok jar gömebilir (örn. Mod Menu, Fabric API'nin
        // bazı modüllerini taşır). En çok kimlik sağlayan jar asıl sağlayıcı sayılır.
        let mut by_id: HashMap<&str, usize> = HashMap::new();
        for (i, m) in mods.iter().enumerate() {
            for id in &m.provides {
                by_id
                    .entry(id.as_str())
                    .and_modify(|cur| {
                        if mods[*cur].provides.len() < m.provides.len() {
                            *cur = i;
                        }
                    })
                    .or_insert(i);
            }
        }
        let deps: Vec<BTreeSet<usize>> = mods
            .iter()
            .enumerate()
            .map(|(i, m)| m.depends.iter().filter_map(|d| by_id.get(d.as_str()).copied()).filter(|&j| j != i).collect())
            .collect();
        let mut dependents = vec![0usize; mods.len()];
        for d in &deps {
            for &j in d {
                dependents[j] += 1;
            }
        }
        let all: BTreeSet<usize> = (0..mods.len()).collect();
        let mut libs: BTreeSet<usize> = mods.iter().enumerate().filter(|(i, m)| is_library(m, dependents[*i])).map(|(i, _)| i).collect();
        // Kütüphanelerin bağımlılıkları da kütüphane sayılır
        let mut stack: Vec<usize> = libs.iter().copied().collect();
        while let Some(i) = stack.pop() {
            for &d in &deps[i] {
                if libs.insert(d) {
                    stack.push(d);
                }
            }
        }
        if libs.len() == all.len() {
            libs.clear(); // her şey kütüphaneyse ayrım anlamsız
        }
        Self {
            deps,
            suspects: all.clone(),
            last_nonempty: all.clone(),
            all,
            libs,
            always: BTreeSet::new(),
            phase: Phase::Baseline,
            pending: None,
            verdict: None,
            flip: false,
            others_in_row: 0,
            round: 0,
            inconclusive: 0,
        }
    }

    /// Kaba üst sınır: baseline + kütüphane kontrolü + ⌈log2 n⌉ + doğrulama
    pub fn estimated_rounds(n: usize) -> u32 {
        let bits = usize::BITS - n.saturating_sub(1).leading_zeros();
        bits + 3
    }

    pub fn suspects(&self) -> &BTreeSet<usize> {
        &self.suspects
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn verdict(&self) -> Option<&Verdict> {
        self.verdict.as_ref()
    }

    pub fn is_library(&self, i: usize) -> bool {
        self.libs.contains(&i)
    }

    /// i'ye zorunlu olarak bağlı modlar
    pub fn dependents(&self, i: usize) -> Vec<usize> {
        (0..self.deps.len()).filter(|&j| self.deps[j].contains(&i)).collect()
    }

    pub fn closure(&self, seed: &BTreeSet<usize>) -> BTreeSet<usize> {
        let mut out = seed.clone();
        let mut stack: Vec<usize> = seed.iter().copied().collect();
        while let Some(i) = stack.pop() {
            for &d in &self.deps[i] {
                if out.insert(d) {
                    stack.push(d);
                }
            }
        }
        out
    }

    fn with_always(&self, s: &BTreeSet<usize>) -> BTreeSet<usize> {
        self.closure(&s.union(&self.always).copied().collect())
    }

    /// Gizli bağımlılık bulundu (ör. eksik sınıfı sağlayan mod): bundan sonra hep açık
    /// tutulur ve şüpheli listesinden çıkar. Bekleyen deneme yeniden kurulur.
    pub fn force_enable(&mut self, i: usize) -> bool {
        if self.always.contains(&i) {
            return false;
        }
        self.always.insert(i);
        if self.suspects.len() > 1 {
            self.suspects.remove(&i);
        }
        self.pending = None;
        true
    }

    /// Sıradaki deneme; av bittiyse None.
    pub fn next(&mut self) -> Option<Test> {
        if self.phase == Phase::Done {
            return None;
        }
        if let Some(t) = &self.pending {
            return Some(t.clone());
        }
        let enabled = match self.phase {
            Phase::Baseline => self.all.clone(),
            Phase::Libraries => self.closure(&self.libs),
            Phase::Hunting => {
                let s: Vec<usize> = self.suspects.iter().copied().collect();
                let mid = s.len() / 2;
                let a: BTreeSet<usize> = s[..mid].iter().copied().collect();
                let b: BTreeSet<usize> = s[mid..].iter().copied().collect();
                let (first, second) = if self.flip { (b, a) } else { (a, b) };
                let ea = self.with_always(&first);
                let eb = self.with_always(&second);
                if !ea.is_superset(&self.suspects) {
                    ea
                } else if !eb.is_superset(&self.suspects) {
                    eb
                } else {
                    // Bağımlılıklar yüzünden bölünemiyor → grubu doğrula
                    self.phase = Phase::Verify;
                    self.with_always(&self.suspects)
                }
            }
            Phase::Verify => self.with_always(&self.suspects),
            Phase::Done => unreachable!(),
        };
        let t = Test { phase: self.phase, enabled };
        self.pending = Some(t.clone());
        Some(t)
    }

    pub fn record(&mut self, res: Res) {
        let Some(test) = self.pending.take() else { return };
        self.round += 1;
        if res == Res::Other {
            self.inconclusive += 1;
        }
        match test.phase {
            Phase::Baseline => {
                if res == Res::Ok {
                    return self.finish(Verdict::NotReproduced);
                }
                if self.suspects.len() <= 1 {
                    return self.finish(Verdict::Culprit { mods: self.suspects.iter().copied().collect() });
                }
                self.phase = if self.libs.is_empty() { Phase::Hunting } else { Phase::Libraries };
            }
            Phase::Libraries => {
                if res == Res::Crash {
                    // Sorun kütüphanelerin kendisinde: yalnızca onların arasında ara
                    self.suspects = self.libs.clone();
                } else {
                    // Kütüphaneler tek başına sağlam → hep açık kalsınlar, asıl modlarda ara
                    self.always = self.libs.clone();
                    self.suspects = self.all.difference(&self.libs).copied().collect();
                }
                self.last_nonempty = self.suspects.clone();
                if self.suspects.is_empty() {
                    return self.finish(Verdict::Combination { suspects: self.libs.iter().copied().collect() });
                }
                self.phase = if self.suspects.len() == 1 { Phase::Verify } else { Phase::Hunting };
            }
            Phase::Hunting => match res {
                Res::Crash | Res::Ok => {
                    self.others_in_row = 0;
                    self.flip = false;
                    if res == Res::Crash {
                        self.suspects = self.suspects.intersection(&test.enabled).copied().collect();
                    } else {
                        self.suspects = self.suspects.difference(&test.enabled).copied().collect();
                    }
                    if self.suspects.is_empty() {
                        return self.finish(Verdict::Combination { suspects: self.last_nonempty.iter().copied().collect() });
                    }
                    self.last_nonempty = self.suspects.clone();
                    if self.suspects.len() == 1 {
                        self.phase = Phase::Verify;
                    }
                }
                Res::Other => {
                    // Bu bölünme gizli bir bağımlılığı kopardı: öteki yarıyı dene.
                    self.others_in_row += 1;
                    self.flip = !self.flip;
                    if self.others_in_row >= 2 {
                        return self.finish(Verdict::Combination { suspects: self.suspects.iter().copied().collect() });
                    }
                }
            },
            Phase::Verify => {
                let ids: Vec<usize> = self.suspects.iter().copied().collect();
                return self.finish(if res == Res::Crash { Verdict::Culprit { mods: ids } } else { Verdict::Combination { suspects: ids } });
            }
            Phase::Done => {}
        }
    }

    fn finish(&mut self, v: Verdict) {
        self.phase = Phase::Done;
        self.verdict = Some(v);
    }
}

/// Dosya sistemini bir denemenin etkin kümesine getirir.
pub fn apply(mods_dir: &Path, mods: &[ModInfo], enabled: &BTreeSet<usize>) -> Result<()> {
    for (i, m) in mods.iter().enumerate() {
        let on = mods_dir.join(&m.file);
        let off = mods_dir.join(format!("{}{OFF_SUFFIX}", m.file));
        if enabled.contains(&i) {
            if off.exists() && !on.exists() {
                crate::util::retry(|| std::fs::rename(&off, &on)).map_err(|e| crate::error::AppError::at(std::path::Path::new(&off), e))?;
            }
        } else if on.exists() {
            crate::util::retry(|| std::fs::rename(&on, &off)).map_err(|e| crate::error::AppError::at(std::path::Path::new(&on), e))?;
        }
    }
    Ok(())
}

/// Ashi'nin kapattığı her şeyi geri açar. Av bitince, iptal edilince ve
/// launcher açılışında (yarıda kalmış av ihtimaline karşı) çağrılır.
pub fn restore(mods_dir: &Path) -> usize {
    let mut n = 0;
    let Ok(rd) = std::fs::read_dir(mods_dir) else { return 0 };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if let Some(base) = name.strip_suffix(OFF_SUFFIX) {
            let target = mods_dir.join(base);
            if !target.exists() && std::fs::rename(e.path(), target).is_ok() {
                n += 1;
            }
        }
    }
    n
}

pub fn restore_all(instances_root: &Path) {
    let Ok(rd) = std::fs::read_dir(instances_root) else { return };
    for e in rd.flatten() {
        let n = restore(&e.path().join("minecraft").join("mods"));
        if n > 0 {
            tracing::info!("yarım kalan avdan {n} mod geri açıldı: {}", e.path().display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(file: &str, provides: &[&str], depends: &[&str]) -> ModInfo {
        ModInfo {
            file: file.into(),
            name: file.into(),
            provides: provides.iter().map(|s| s.to_string()).collect(),
            depends: depends.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// Simülasyon: `bad` kümesinin tamamı etkinse çöker.
    fn run(mods: &[ModInfo], bad: &[usize]) -> (Verdict, u32) {
        let mut p = Planner::new(mods);
        while let Some(t) = p.next() {
            for i in &t.enabled {
                // Her etkin modun bağımlılıkları da etkin olmalı
                assert!(p.deps[*i].is_subset(&t.enabled), "eksik bağımlılıkla test");
            }
            let crashed = bad.iter().all(|b| t.enabled.contains(b));
            p.record(if crashed { Res::Crash } else { Res::Ok });
            assert!(p.round < 40);
        }
        (p.verdict().unwrap().clone(), p.round)
    }

    fn pack(n: usize) -> Vec<ModInfo> {
        let mut v = vec![m("fabric-api.jar", &["fabric-api", "fabric-api-base"], &["fabricloader", "minecraft"])];
        v.push(m("architectury.jar", &["architectury"], &["fabric-api"]));
        for i in 2..n {
            let dep: &[&str] = if i % 3 == 0 { &["fabric-api", "architectury"] } else if i % 2 == 0 { &["fabric-api"] } else { &[] };
            v.push(m(&format!("mod{i:03}.jar"), &[&format!("mod{i}")], dep));
        }
        v
    }

    #[test]
    fn finds_every_single_culprit_within_budget() {
        let mods = pack(200);
        let budget = Planner::estimated_rounds(mods.len());
        for bad in 0..mods.len() {
            let (v, rounds) = run(&mods, &[bad]);
            assert_eq!(v, Verdict::Culprit { mods: vec![bad] }, "suçlu {bad}");
            assert!(rounds <= budget + 1, "suçlu {bad}: {rounds} tur > {budget}");
        }
    }

    #[test]
    fn library_culprit_is_reported() {
        // Suçlu herkesin bağımlı olduğu kütüphane olsa bile bulunur
        let mods = pack(50);
        assert_eq!(run(&mods, &[0]).0, Verdict::Culprit { mods: vec![0] });
    }

    #[test]
    fn not_reproduced_stops_after_baseline() {
        let mods = pack(30);
        let mut p = Planner::new(&mods);
        p.next();
        p.record(Res::Ok);
        assert_eq!(p.verdict(), Some(&Verdict::NotReproduced));
        assert_eq!(p.round, 1);
    }

    #[test]
    fn two_mod_interaction_is_flagged_honestly() {
        let mods = pack(64);
        match run(&mods, &[10, 50]).0 {
            Verdict::Combination { .. } | Verdict::Culprit { .. } => {}
            v => panic!("beklenmeyen {v:?}"),
        }
        // Birbirine bağlı olmayan iki mod tekil suçlu olarak raporlanmamalı
        assert!(!matches!(run(&mods, &[10, 50]).0, Verdict::Culprit { ref mods } if mods.len() == 1));
    }

    /// Kütüphaneler (Fabric API, Kotlin…) suçlu değilken hiçbir denemede kapatılmaz.
    #[test]
    fn libraries_stay_enabled_while_hunting_mods() {
        let mut mods = pack(40);
        mods.push(m("fabric-language-kotlin.jar", &["fabric-language-kotlin"], &[]));
        let kotlin = mods.len() - 1;
        let bad = 17;
        let mut p = Planner::new(&mods);
        assert!(p.is_library(0) && p.is_library(1) && p.is_library(kotlin));
        while let Some(t) = p.next() {
            if t.phase == Phase::Hunting || t.phase == Phase::Verify {
                assert!(t.enabled.contains(&0) && t.enabled.contains(&kotlin), "kütüphane kapatıldı");
            }
            p.record(if t.enabled.contains(&bad) { Res::Crash } else { Res::Ok });
        }
        assert_eq!(p.verdict(), Some(&Verdict::Culprit { mods: vec![bad] }));
    }

    /// Bir mod kapatılınca başka bir mod farklı hatayla çökse bile (gizli bağımlılık)
    /// asıl suçlu bulunur; farklı hata "suçlu burada" diye sayılmaz.
    #[test]
    fn hidden_dependency_crash_is_not_mistaken_for_the_real_one() {
        let mods = pack(32);
        let bad = 9;
        // mod020 gizlice mod021'e bağlı (beyan etmemiş): 21 kapalı + 20 açık → farklı hata
        let mut p = Planner::new(&mods);
        let mut guard = 0;
        while let Some(t) = p.next() {
            guard += 1;
            assert!(guard < 40);
            let res = if t.enabled.contains(&20) && !t.enabled.contains(&21) {
                Res::Other
            } else if t.enabled.contains(&bad) {
                Res::Crash
            } else {
                Res::Ok
            };
            p.record(res);
        }
        match p.verdict().unwrap() {
            Verdict::Culprit { mods } => assert_eq!(mods, &vec![bad]),
            Verdict::Combination { suspects } => assert!(suspects.contains(&bad)),
            v => panic!("{v:?}"),
        }
    }

    #[test]
    fn estimate() {
        assert_eq!(Planner::estimated_rounds(2), 4);
        assert_eq!(Planner::estimated_rounds(200), 11);
    }

    #[test]
    fn apply_and_restore_roundtrip() {
        let dir = std::env::temp_dir().join(format!("ashi-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mods: Vec<ModInfo> = (0..4).map(|i| m(&format!("m{i}.jar"), &[], &[])).collect();
        for x in &mods {
            std::fs::write(dir.join(&x.file), b"").unwrap();
        }
        std::fs::write(dir.join("user.jar.disabled"), b"").unwrap();
        apply(&dir, &mods, &[1, 3].into_iter().collect()).unwrap();
        assert!(dir.join("m0.jar.ashi-off").exists() && dir.join("m1.jar").exists());
        assert_eq!(restore(&dir), 2);
        assert!((0..4).all(|i| dir.join(format!("m{i}.jar")).exists()));
        assert!(dir.join("user.jar.disabled").exists(), "kullanıcının kapattığı moda dokunulmamalı");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
