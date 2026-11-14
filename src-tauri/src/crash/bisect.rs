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

#[derive(Debug, Clone)]
pub struct Test {
    pub phase: Phase,
    pub enabled: BTreeSet<usize>,
}

pub struct Planner {
    deps: Vec<BTreeSet<usize>>,
    all: BTreeSet<usize>,
    suspects: BTreeSet<usize>,
    last_nonempty: BTreeSet<usize>,
    phase: Phase,
    pending: Option<Test>,
    verdict: Option<Verdict>,
    pub round: u32,
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
        let deps = mods
            .iter()
            .enumerate()
            .map(|(i, m)| {
                // Hiçbir jar'ın sağlamadığı kimlikler (minecraft, fabricloader, java…) yok sayılır
                m.depends.iter().filter_map(|d| by_id.get(d.as_str()).copied()).filter(|&j| j != i).collect()
            })
            .collect();
        let all: BTreeSet<usize> = (0..mods.len()).collect();
        Self {
            deps,
            suspects: all.clone(),
            last_nonempty: all.clone(),
            all,
            phase: Phase::Baseline,
            pending: None,
            verdict: None,
            round: 0,
        }
    }

    /// Kaba üst sınır: baseline + ⌈log2 n⌉ + doğrulama
    pub fn estimated_rounds(n: usize) -> u32 {
        let bits = usize::BITS - n.saturating_sub(1).leading_zeros();
        bits + 2
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
            Phase::Hunting => {
                let s: Vec<usize> = self.suspects.iter().copied().collect();
                let mid = s.len() / 2;
                let a: BTreeSet<usize> = s[..mid].iter().copied().collect();
                let b: BTreeSet<usize> = s[mid..].iter().copied().collect();
                let ea = self.closure(&a);
                let eb = self.closure(&b);
                if !ea.is_superset(&self.suspects) {
                    ea
                } else if !eb.is_superset(&self.suspects) {
                    eb
                } else {
                    // Bağımlılıklar yüzünden bölünemiyor → grubu doğrula
                    self.phase = Phase::Verify;
                    self.closure(&self.suspects)
                }
            }
            Phase::Verify => self.closure(&self.suspects),
            Phase::Done => unreachable!(),
        };
        let t = Test { phase: self.phase, enabled };
        self.pending = Some(t.clone());
        Some(t)
    }

    pub fn record(&mut self, crashed: bool) {
        let Some(test) = self.pending.take() else { return };
        self.round += 1;
        match test.phase {
            Phase::Baseline => {
                if !crashed {
                    return self.finish(Verdict::NotReproduced);
                }
                self.phase = if self.suspects.len() <= 1 { Phase::Verify } else { Phase::Hunting };
                if self.phase == Phase::Verify {
                    // Tek mod varsa baseline zaten doğrulamadır
                    return self.finish(Verdict::Culprit { mods: self.suspects.iter().copied().collect() });
                }
            }
            Phase::Hunting => {
                if crashed {
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
            Phase::Verify => {
                let ids: Vec<usize> = self.suspects.iter().copied().collect();
                return self.finish(if crashed { Verdict::Culprit { mods: ids } } else { Verdict::Combination { suspects: ids } });
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
                std::fs::rename(&off, &on)?;
            }
        } else if on.exists() {
            std::fs::rename(&on, &off)?;
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
            p.record(crashed);
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
        p.record(false);
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

    #[test]
    fn estimate() {
        assert_eq!(Planner::estimated_rounds(2), 3);
        assert_eq!(Planner::estimated_rounds(200), 10);
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
