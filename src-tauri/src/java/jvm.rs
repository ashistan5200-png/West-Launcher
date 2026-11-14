//! Donanım farkındalıklı JVM optimizatörü.

use serde::Serialize;
use sysinfo::System;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub total_memory_mb: u64,
    pub available_memory_mb: u64,
    pub logical_cores: usize,
    pub cpu_brand: String,
}

pub fn hardware() -> Hardware {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    Hardware {
        total_memory_mb: sys.total_memory() / 1024 / 1024,
        available_memory_mb: sys.available_memory() / 1024 / 1024,
        logical_cores: sys.cpus().len().max(1),
        cpu_brand: sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub enum Gc {
    GenerationalZgc,
    G1,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JvmProfile {
    pub memory_mb: u32,
    pub gc: Gc,
    pub flags: Vec<String>,
    pub reason: String,
}

/// Mod sayısına ve sisteme göre önerilen heap (MB).
/// Kural: işletim sistemine en az %35 bırak; vanilla 2–4 GB, modlu 4–10 GB.
pub fn recommend_memory(hw: &Hardware, mod_count: usize) -> u32 {
    let total = hw.total_memory_mb as f64;
    let ceiling = (total * 0.65) as u32;
    let want: u32 = match mod_count {
        0 => 2560,
        1..=40 => 4096,
        41..=150 => 6144,
        151..=300 => 8192,
        _ => 10240,
    };
    want.min(ceiling).max(1024) / 256 * 256
}

/// Java sürümü + donanım + heap'e göre GC ve bayrak seti.
/// - Java 21+, ≥4 çekirdek, heap ≥ 6 GB → Generational ZGC (mikro takılmasız, düşük pause)
/// - Diğer durumlar → Aikar tabanlı ayarlı G1GC
pub fn optimize(java_major: u32, hw: &Hardware, memory_mb: u32) -> JvmProfile {
    let mut flags = vec![
        "-XX:+UnlockExperimentalVMOptions".to_string(),
        "-XX:+DisableExplicitGC".into(),
        "-XX:+AlwaysPreTouch".into(),
        "-XX:+ParallelRefProcEnabled".into(),
        "-Dfile.encoding=UTF-8".into(),
    ];

    if java_major >= 21 && hw.logical_cores >= 4 && memory_mb >= 6144 {
        flags.push("-XX:+UseZGC".into());
        if java_major < 23 {
            // 23+ sürümlerde varsayılan; bayrak kullanımdan kaldırıldı
            flags.push("-XX:+ZGenerational".into());
        }
        flags.push(format!("-XX:ConcGCThreads={}", (hw.logical_cores / 4).max(1)));
        return JvmProfile {
            memory_mb,
            gc: Gc::GenerationalZgc,
            flags,
            reason: format!("Java {java_major}, {} çekirdek ve {memory_mb} MB heap → Generational ZGC", hw.logical_cores),
        };
    }

    let big = memory_mb > 12288;
    flags.extend([
        "-XX:+UseG1GC".into(),
        "-XX:MaxGCPauseMillis=200".into(),
        format!("-XX:G1NewSizePercent={}", if big { 40 } else { 30 }),
        format!("-XX:G1MaxNewSizePercent={}", if big { 50 } else { 40 }),
        format!("-XX:G1HeapRegionSize={}M", if big { 16 } else { 8 }),
        format!("-XX:G1ReservePercent={}", if big { 15 } else { 20 }),
        "-XX:G1HeapWastePercent=5".into(),
        "-XX:G1MixedGCCountTarget=4".into(),
        format!("-XX:InitiatingHeapOccupancyPercent={}", if big { 20 } else { 15 }),
        "-XX:G1MixedGCLiveThresholdPercent=90".into(),
        "-XX:G1RSetUpdatingPauseTimePercent=5".into(),
        "-XX:SurvivorRatio=32".into(),
        "-XX:+PerfDisableSharedMem".into(),
        "-XX:MaxTenuringThreshold=1".into(),
    ]);
    if java_major >= 17 {
        flags.push("-XX:+UseStringDeduplication".into());
    }
    JvmProfile {
        memory_mb,
        gc: Gc::G1,
        flags,
        reason: format!("Java {java_major}, {memory_mb} MB heap → ayarlı G1GC (Aikar)"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hw(mem: u64, cores: usize) -> Hardware {
        Hardware { total_memory_mb: mem, available_memory_mb: mem / 2, logical_cores: cores, cpu_brand: String::new() }
    }
    #[test]
    fn picks_zgc_on_modern_big_heap() {
        assert_eq!(optimize(21, &hw(32768, 16), 8192).gc, Gc::GenerationalZgc);
        assert_eq!(optimize(17, &hw(32768, 16), 8192).gc, Gc::G1);
        assert_eq!(optimize(21, &hw(8192, 4), 4096).gc, Gc::G1);
    }
    #[test]
    fn memory_respects_ceiling() {
        assert!(recommend_memory(&hw(4096, 4), 200) <= 2662);
        assert_eq!(recommend_memory(&hw(32768, 8), 0), 2560);
    }
}
