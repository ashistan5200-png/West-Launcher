//! Ashi Çözücü: çökme raporunu okuyup suçlu modu ve nedeni bulur. Oyunu yeniden çalıştırmaz;
//! oyun içinde (ör. bir HUD çizilirken) olan çökmeleri de anında açıklar.
//!
//! Suçlu şu sırayla aranır:
//! 1. Çağrı yığınındaki ilk Minecraft/Java/yükleyici dışı sınıf → o sınıfı içeren mod jar'ı
//! 2. Mixin işleyici adları ("handler$abc000$modid$method") → mod kimliği
//! 3. Yükleyicinin kendi mesajları ("Mixin apply for mod X failed", eksik bağımlılıklar)

use super::modinfo::{self, ModInfo};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Cause {
    /// Mod, adında geçersiz karakter (Türkçe harf, büyük harf, boşluk) olan bir dosya kullanıyor
    BadResourcePath,
    OutOfMemory,
    MixinFailed,
    MissingClass,
    MissingDependency,
    JavaVersion,
    Graphics,
    DuplicateMod,
    /// Sınıflandırılamayan bir hata (yine de suçlu bulunabilir)
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Culprit {
    pub file: String,
    pub name: String,
    pub ids: Vec<String>,
    /// West Companion'ın kendisi mi
    pub ours: bool,
    /// Kütüphane (Fabric API vb.) — kapatmak başka modları da bozar
    pub library: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    /// Okunan dosya (oyun klasörüne göre), ör. "crash-reports/crash-....txt"
    pub source: String,
    pub cause: Cause,
    /// Nedene özgü ayrıntı (geçersiz dosya yolu, eksik sınıf, eksik bağımlılık satırları…)
    pub detail: Option<String>,
    pub description: Option<String>,
    /// Hata satırı (ör. "java.lang.NullPointerException: ...")
    pub exception: Option<String>,
    pub culprit: Option<Culprit>,
    /// Suçluyu gösteren yığın satırı
    pub frame: Option<String>,
    /// Suçlu nasıl bulundu: "stack" | "mixin" | "loader"
    pub via: Option<String>,
}

/// Oyuna, Java'ya ve yükleyiciye ait sınıflar suçlu sayılmaz
const SKIP: &[&str] = &[
    "java.", "javax.", "jdk.", "sun.", "com.sun.", "net.minecraft.", "com.mojang.", "net.fabricmc.", "org.quiltmc.", "net.minecraftforge.",
    "net.neoforged.", "cpw.mods.", "org.spongepowered.", "com.llamalad7.", "org.lwjgl.", "io.netty.", "com.google.", "org.apache.", "it.unimi.",
    "org.slf4j.", "kotlin.", "org.objectweb.", "oshi.", "com.github.benmanes.", "org.joml.", "knot.", "MC-BOOTSTRAP",
];

/// Son çökme dosyası: verilen dosya ya da son `within` içinde yazılmış en yeni crash raporu, yoksa latest.log
pub fn find_report(game_dir: &Path, rel: Option<&str>, within: Duration) -> Option<(String, PathBuf)> {
    if let Some(r) = rel {
        let (dir, name) = r.split_once('/')?;
        if !matches!(dir, "logs" | "crash-reports") || name.contains(['/', '\\']) || name.contains("..") {
            return None;
        }
        let p = game_dir.join(dir).join(name);
        return p.is_file().then(|| (r.to_string(), p));
    }
    let now = SystemTime::now();
    let fresh = |p: &Path| p.metadata().and_then(|m| m.modified()).map(|t| now.duration_since(t).unwrap_or_default() <= within).unwrap_or(false);
    let mut best: Option<(SystemTime, String, PathBuf)> = None;
    if let Ok(rd) = std::fs::read_dir(game_dir.join("crash-reports")) {
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".txt") || !fresh(&p) {
                continue;
            }
            let t = p.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
            if best.as_ref().map(|b| t > b.0).unwrap_or(true) {
                best = Some((t, format!("crash-reports/{name}"), p));
            }
        }
    }
    if let Some((_, r, p)) = best {
        return Some((r, p));
    }
    let latest = game_dir.join("logs").join("latest.log");
    (latest.is_file() && fresh(&latest)).then(|| ("logs/latest.log".to_string(), latest))
}

fn read_text(p: &Path) -> String {
    let b = std::fs::read(p).unwrap_or_default();
    // Çok büyük loglarda son 2 MB yeter
    let s = if b.len() > 2_000_000 { &b[b.len() - 2_000_000..] } else { &b[..] };
    String::from_utf8_lossy(s).into_owned()
}

/// "at knot//com.example.Foo.bar(Foo.java:12)" → "com.example.Foo"
fn frame_class(line: &str) -> Option<String> {
    let l = line.trim().strip_prefix("at ")?;
    let l = l.split('(').next()?.trim();
    // Modül ön ekleri: "knot//", "java.base/", "TRANSFORMER/modid@1.0/"
    let l = l.rsplit('/').next()?;
    let (class, _method) = l.rsplit_once('.')?;
    // İç sınıf / lambda: Foo$Bar → Foo
    let class = class.split('$').next()?.to_string();
    (!class.is_empty()).then_some(class)
}

fn skipped(class: &str) -> bool {
    SKIP.iter().any(|s| class.starts_with(s)) || !class.contains('.')
}

/// Mixin işleyicisinden mod kimliği: "handler$zjo000$fabric-rendering-v1$render" → "fabric-rendering-v1"
fn mixin_mod(line: &str) -> Option<String> {
    for key in ["handler$", "redirect$", "modify$", "wrapOperation$", "localvar$", "modifyExpressionValue$", "modifyReturnValue$", "wrapWithCondition$"] {
        if let Some(i) = line.find(key) {
            let rest = &line[i + key.len()..];
            let mut parts = rest.split('$');
            let _hash = parts.next()?;
            let id = parts.next()?;
            if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
                return Some(id.to_string());
            }
        }
    }
    None
}

fn classify(text: &str) -> (Cause, Option<String>) {
    let find_line = |needle: &str| text.lines().find(|l| l.contains(needle)).map(|l| l.trim().to_string());
    if let Some(l) = find_line("character in path of location") {
        let loc = l.rsplit("location: ").next().map(|s| s.trim().to_string());
        return (Cause::BadResourcePath, loc);
    }
    if text.contains("java.lang.OutOfMemoryError") {
        return (Cause::OutOfMemory, None);
    }
    if text.contains("UnsupportedClassVersionError") {
        return (Cause::JavaVersion, find_line("UnsupportedClassVersionError"));
    }
    if text.contains("Incompatible mods found") || text.contains("Incompatible mod set") || text.contains("requires any version of") || text.contains("Mod resolution failed") {
        let lines: Vec<String> = text
            .lines()
            .filter(|l| l.contains("requires") || l.contains("Install ") || l.contains("is incompatible") || l.contains("Replace mod"))
            .map(|l| l.trim().trim_start_matches("- ").to_string())
            .take(6)
            .collect();
        return (Cause::MissingDependency, (!lines.is_empty()).then(|| lines.join("\n")));
    }
    if text.contains("Duplicate mod") || text.contains("duplicate mods") || text.contains("DuplicateModsFoundException") {
        return (Cause::DuplicateMod, find_line("uplicate"));
    }
    if text.contains("Mixin apply") || text.contains("MixinApplyError") || text.contains("InvalidInjectionException") || text.contains("MixinTransformerError") {
        return (Cause::MixinFailed, find_line("Mixin apply").or_else(|| find_line("InvalidInjectionException")));
    }
    if let Some(l) = find_line("NoClassDefFoundError").or_else(|| find_line("ClassNotFoundException")) {
        let class = l.rsplit([' ', ':']).next().map(|s| s.replace('/', ".")).filter(|s| s.contains('.'));
        return (Cause::MissingClass, class);
    }
    if text.contains("GLFW error") || text.contains("Pixel format not accelerated") || text.contains("OpenGL") && text.contains("not supported") || text.contains("EXCEPTION_ACCESS_VIOLATION") {
        return (Cause::Graphics, find_line("GLFW error").or_else(|| find_line("Pixel format")));
    }
    (Cause::Unknown, None)
}

fn culprit_from(m: &ModInfo, mods: &[ModInfo]) -> Culprit {
    let dependents = mods.iter().filter(|o| o.depends.iter().any(|d| m.provides.contains(d))).count();
    Culprit {
        file: m.file.clone(),
        name: m.name.clone(),
        ids: m.provides.iter().cloned().collect(),
        ours: m.file.starts_with(crate::companion::JAR_PREFIX),
        library: super::bisect::is_library(m, dependents),
    }
}

/// Mod listesi (West Companion dahil; çökme ondan da gelebilir)
fn all_mods(mods_dir: &Path) -> Vec<ModInfo> {
    let mut mods = modinfo::scan(mods_dir).unwrap_or_default();
    if let Ok(rd) = std::fs::read_dir(mods_dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with(crate::companion::JAR_PREFIX) && name.ends_with(".jar") {
                if let Ok(m) = modinfo::read_mod(&e.path()) {
                    mods.push(m);
                }
            }
        }
    }
    mods
}

pub fn analyze_text(text: &str, source: String, mods_dir: &Path) -> Analysis {
    let mods = all_mods(mods_dir);
    let (cause, detail) = classify(text);

    let description = text.lines().find_map(|l| l.strip_prefix("Description: ")).map(|s| s.trim().to_string());
    // Hata satırı: Description'dan sonraki ilk dolu satır, yoksa ilk "Exception"/"Error" satırı
    let exception = text
        .split("Description: ")
        .nth(1)
        .and_then(|rest| rest.lines().skip(1).map(str::trim).find(|l| !l.is_empty()).map(String::from))
        .or_else(|| text.lines().find(|l| (l.contains("Exception") || l.contains("Error:")) && !l.trim_start().starts_with("at ")).map(|l| l.trim().to_string()))
        .map(|s| s.chars().take(400).collect());

    let mut culprit = None;
    let mut frame = None;
    let mut via = None;

    // 1) Yığındaki ilk mod sınıfı
    let frames: Vec<&str> = text.lines().filter(|l| l.trim_start().starts_with("at ")).collect();
    let mut tried = 0;
    'outer: for line in &frames {
        let Some(class) = frame_class(line) else { continue };
        if skipped(&class) {
            continue;
        }
        tried += 1;
        if tried > 8 {
            break;
        }
        let entry = class.replace('.', "/");
        for m in &mods {
            if modinfo::jar_has_class(&mods_dir.join(&m.file), &entry) {
                culprit = Some(culprit_from(m, &mods));
                frame = Some(line.trim().to_string());
                via = Some("stack".to_string());
                break 'outer;
            }
        }
    }

    // 2) Mixin işleyicisi
    if culprit.is_none() {
        'mx: for line in &frames {
            if let Some(id) = mixin_mod(line) {
                if let Some(m) = mods.iter().find(|m| m.provides.contains(&id)) {
                    culprit = Some(culprit_from(m, &mods));
                    frame = Some(line.trim().to_string());
                    via = Some("mixin".to_string());
                    break 'mx;
                }
            }
        }
    }

    // 3) Yükleyici mesajı: "Mixin apply for mod X failed"
    if culprit.is_none() {
        if let Some(l) = text.lines().find(|l| l.contains("Mixin apply for mod ")) {
            if let Some(id) = l.split("Mixin apply for mod ").nth(1).and_then(|r| r.split_whitespace().next()) {
                if let Some(m) = mods.iter().find(|m| m.provides.contains(id)) {
                    culprit = Some(culprit_from(m, &mods));
                    frame = Some(l.trim().to_string());
                    via = Some("loader".to_string());
                }
            }
        }
    }

    // Eksik sınıf: kim istiyor değil, hangi mod sağlamalıydı — ayrıntıda kalır
    Analysis { source, cause, detail, description, exception, culprit, frame, via }
}

pub fn analyze(game_dir: &Path, rel: Option<&str>) -> Option<Analysis> {
    let (source, path) = find_report(game_dir, rel, Duration::from_secs(15 * 60))?;
    let text = read_text(&path);
    // latest.log'da çökme izi yoksa analiz yok
    if source.starts_with("logs/") && !(text.contains("Exception") || text.contains("Error") || text.contains("Incompatible mods")) {
        return None;
    }
    Some(analyze_text(&text, source, &game_dir.join("mods")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn jar(path: &Path, id: &str, classes: &[&str]) {
        let f = std::fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let o = zip::write::SimpleFileOptions::default();
        z.start_file("fabric.mod.json", o).unwrap();
        z.write_all(format!(r#"{{"id":"{id}","name":"{id} Mod","depends":{{"fabricloader":"*"}}}}"#).as_bytes()).unwrap();
        for c in classes {
            z.start_file(*c, o).unwrap();
            z.write_all(b"x").unwrap();
        }
        z.finish().unwrap();
    }

    const REPORT: &str = "---- Minecraft Crash Report ----
Description: Unexpected error

net.minecraft.class_151: Non [a-z0-9/._-] character in path of location: example:textures/gui/element_f\u{131}re.png
\tat knot//net.minecraft.class_2960.method_45137(class_2960.java:252)
\tat knot//com.example.EXAMPLE.id(EXAMPLE.java:23)
\tat knot//com.example.client.WandHud.iconTexture(WandHud.java:30)
\tat knot//net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback.lambda$static$0(HudRenderCallback.java:27)
\tat knot//net.minecraft.class_329.handler$zjo000$fabric-rendering-v1$render(class_329.java:1386)
";

    #[test]
    fn finds_culprit_and_cause() {
        let dir = std::env::temp_dir().join(format!("west-crash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        jar(&dir.join("sodium.jar"), "sodium", &["net/caffeinemc/Sodium.class"]);
        jar(&dir.join("wand.jar"), "wandmod", &["com/example/EXAMPLE.class", "com/example/client/WandHud.class"]);
        let a = analyze_text(REPORT, "crash-reports/x.txt".into(), &dir);
        assert_eq!(a.cause, Cause::BadResourcePath);
        assert_eq!(a.detail.as_deref(), Some("example:textures/gui/element_f\u{131}re.png"));
        assert_eq!(a.description.as_deref(), Some("Unexpected error"));
        assert!(a.exception.unwrap().contains("Non [a-z0-9"));
        let c = a.culprit.unwrap();
        assert_eq!(c.file, "wand.jar");
        assert_eq!(a.via.as_deref(), Some("stack"));
        assert!(a.frame.unwrap().contains("EXAMPLE.id"));

        // Yalnızca mixin izi varsa işleyiciden bulunur
        let mixin_only = "Description: Rendering overlay\njava.lang.NullPointerException\n\tat knot//net.minecraft.class_329.handler$abc123$sodium$render(class_329.java:10)\n";
        let a = analyze_text(mixin_only, "logs/latest.log".into(), &dir);
        assert_eq!(a.culprit.unwrap().file, "sodium.jar");
        assert_eq!(a.via.as_deref(), Some("mixin"));

        // Bellek
        let a = analyze_text("java.lang.OutOfMemoryError: Java heap space", "logs/latest.log".into(), &dir);
        assert_eq!(a.cause, Cause::OutOfMemory);
        assert!(a.culprit.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn frame_parsing() {
        assert_eq!(frame_class("\tat knot//com.example.client.WandHud.iconTexture(WandHud.java:30)").as_deref(), Some("com.example.client.WandHud"));
        assert_eq!(frame_class("at java.base/java.lang.Thread.run(Thread.java:1474)").as_deref(), Some("java.lang.Thread"));
        assert_eq!(frame_class("at TRANSFORMER/create@0.5/com.simibubi.create.Foo$Bar.baz(Foo.java:1)").as_deref(), Some("com.simibubi.create.Foo"));
        assert_eq!(mixin_mod("at knot//net.minecraft.class_329.handler$zjo000$fabric-rendering-v1$render(x)").as_deref(), Some("fabric-rendering-v1"));
    }
}
