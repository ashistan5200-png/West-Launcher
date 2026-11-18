//! Ashi Çözücü onarımları: bozuk bir mod jar'ını düzeltip yeniden paketler.
//!
//! Şu an onarılan hata: geçersiz kaynak yolu ("Non [a-z0-9/._-] character in path of location").
//! Mod, adında Türkçe harf, büyük harf ya da boşluk olan dosyalar kullanıyorsa:
//! 1. `assets/` altındaki bu dosyaların adları geçerli hale getirilir (ı→i, ş→s, büyük→küçük, boşluk→_)
//! 2. Sınıf dosyalarının sabit havuzundaki ve json/metin dosyalarındaki aynı adlar da değiştirilir
//! 3. Orijinal jar `.ashi-orijinal` uzantısıyla yedeklenir (yükleyici onu görmez); geri alınabilir.

use crate::error::{AppError, Result};
use serde::Serialize;
use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::path::Path;

pub const BACKUP_SUFFIX: &str = ".ashi-orijinal";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixReport {
    /// Düzeltilmiş jar'ın adı
    pub file: String,
    /// Yedek dosyanın adı
    pub backup: String,
    pub renamed: usize,
    pub patched_classes: usize,
    pub patched_files: usize,
    /// Değiştirilen adlar (örnek gösterim için, en fazla 8)
    pub examples: Vec<(String, String)>,
}

/// Bir yol parçası Minecraft'a uygun mu ([a-z0-9/._-])
fn valid(s: &str) -> bool {
    s.chars().all(|c| matches!(c, 'a'..='z' | '0'..='9' | '/' | '.' | '_' | '-'))
}

/// Türkçe ve diğer geçersiz karakterleri geçerli karşılıklarına çevir
pub fn translit(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        let r = match c {
            'ı' | 'İ' | 'î' | 'Î' => "i",
            'ğ' | 'Ğ' => "g",
            'ü' | 'Ü' | 'û' | 'Û' => "u",
            'ş' | 'Ş' => "s",
            'ö' | 'Ö' => "o",
            'ç' | 'Ç' => "c",
            'â' | 'Â' | 'á' | 'à' | 'ä' => "a",
            'é' | 'è' | 'ê' | 'ë' => "e",
            ' ' => "_",
            c if c.is_ascii_uppercase() => {
                out.push(c.to_ascii_lowercase());
                continue;
            }
            c if c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-') => {
                out.push(c);
                continue;
            }
            _ => "_",
        };
        out.push_str(r);
    }
    out
}

/// Bozuk adlardaki geçersiz parçalar: "assets/x/textures/gui/element_fıre.png" → {"element_fıre"}
fn bad_tokens(path: &str) -> Vec<String> {
    path.split(['/', ':', '.'])
        .filter(|t| !t.is_empty() && !valid(t))
        .map(String::from)
        .collect()
}

/// Bir metindeki bozuk parçaları değiştir. ASCII olmayan parçalar her yerde, yalnızca büyük harf/boşluk içerenler
/// yalnızca yol gibi görünen metinlerde değiştirilir (sınıf/metot adlarına dokunmamak için).
fn replace_tokens(s: &str, tokens: &[(String, String)]) -> Option<String> {
    // Kaynak yolu gibi görünen metin: ad alanı (":"), dosya uzantısı ya da bilinen asset klasörüyle başlayan.
    // Sınıf adları ("com/x/Foo") bu tanıma uymaz; onlara yalnızca ASCII olmayan parçalar için dokunulur.
    const DIRS: &[&str] = &["textures/", "models/", "sounds/", "lang/", "blockstates/", "particles/", "shaders/", "font/", "item/", "block/", "entity/", "gui/"];
    let resource = s.contains(':') || [".png", ".json", ".ogg", ".mcmeta", ".nbt"].iter().any(|e| s.contains(e)) || DIRS.iter().any(|d| s.starts_with(d));
    let mut out = s.to_string();
    let mut changed = false;
    for (from, to) in tokens {
        if (!from.is_ascii() || resource) && out.contains(from.as_str()) {
            out = out.replace(from.as_str(), to);
            changed = true;
        }
    }
    changed.then_some(out)
}

/// Sınıf dosyasının sabit havuzundaki UTF-8 sabitlerini değiştir. Yapı bozulmaz: yalnızca bu girdilerin
/// uzunluğu ve içeriği yeniden yazılır. Anlaşılamayan bir dosyada None döner (dokunulmaz).
pub fn patch_class(bytes: &[u8], tokens: &[(String, String)]) -> Option<Vec<u8>> {
    if bytes.len() < 10 || bytes[0..4] != [0xCA, 0xFE, 0xBA, 0xBE] {
        return None;
    }
    let count = u16::from_be_bytes([bytes[8], bytes[9]]) as usize;
    let mut out = Vec::with_capacity(bytes.len() + 64);
    out.extend_from_slice(&bytes[..10]);
    let mut i = 10;
    let mut idx = 1;
    let mut changed = false;
    while idx < count {
        let tag = *bytes.get(i)?;
        match tag {
            1 => {
                let len = u16::from_be_bytes([*bytes.get(i + 1)?, *bytes.get(i + 2)?]) as usize;
                let raw = bytes.get(i + 3..i + 3 + len)?;
                // Değiştirilmiş UTF-8: NUL (C0 80) ve vekil çiftler içeren sabitlere dokunma
                let replaced = std::str::from_utf8(raw).ok().filter(|_| !raw.windows(2).any(|w| w == [0xC0, 0x80])).and_then(|s| replace_tokens(s, tokens));
                match replaced {
                    Some(n) if n.len() <= u16::MAX as usize => {
                        out.push(1);
                        out.extend_from_slice(&(n.len() as u16).to_be_bytes());
                        out.extend_from_slice(n.as_bytes());
                        changed = true;
                    }
                    _ => out.extend_from_slice(&bytes[i..i + 3 + len]),
                }
                i += 3 + len;
            }
            3 | 4 | 9 | 10 | 11 | 12 | 17 | 18 => {
                out.extend_from_slice(bytes.get(i..i + 5)?);
                i += 5;
            }
            5 | 6 => {
                out.extend_from_slice(bytes.get(i..i + 9)?);
                i += 9;
                idx += 1; // iki yuva kaplar
            }
            7 | 8 | 16 | 19 | 20 => {
                out.extend_from_slice(bytes.get(i..i + 3)?);
                i += 3;
            }
            15 => {
                out.extend_from_slice(bytes.get(i..i + 4)?);
                i += 4;
            }
            _ => return None,
        }
        idx += 1;
    }
    out.extend_from_slice(bytes.get(i..)?);
    changed.then_some(out)
}

const TEXT_EXT: &[&str] = &[".json", ".mcmeta", ".properties", ".txt", ".lang", ".toml", ".js"];

/// Jar'ı düzelt. `bad_location` (ör. "example:textures/gui/element_fıre.png") ipucu olarak kullanılır;
/// jar'daki tüm geçersiz asset adları da birlikte düzeltilir.
pub fn fix_bad_paths(mods_dir: &Path, file: &str, bad_location: Option<&str>) -> Result<FixReport> {
    if file.contains(['/', '\\']) || file.contains("..") || !file.ends_with(".jar") {
        return Err(AppError::msg(crate::i18n::t("Geçersiz mod dosyası")));
    }
    let src = mods_dir.join(file);
    let mut zip = zip::ZipArchive::new(std::fs::File::open(&src)?)?;

    // 1) Düzeltilecek adlar
    let mut tokens: BTreeSet<String> = BTreeSet::new();
    if let Some(loc) = bad_location {
        tokens.extend(bad_tokens(loc));
    }
    let names: Vec<String> = zip.file_names().map(String::from).collect();
    for n in &names {
        if n.starts_with("assets/") && !n.ends_with('/') {
            // "assets/<ad alanı>/..." içindeki yol Minecraft'ın kaynak yoludur
            if let Some(rest) = n.splitn(3, '/').nth(2) {
                tokens.extend(bad_tokens(rest));
            }
        }
    }
    if tokens.is_empty() {
        return Err(AppError::msg(crate::i18n::t("Bu modda düzeltilecek geçersiz dosya adı bulunamadı")));
    }
    let pairs: Vec<(String, String)> = {
        // Uzun parçalar önce (iç içe eşleşmeler doğru değişsin)
        let mut v: Vec<(String, String)> = tokens.iter().map(|t| (t.clone(), translit(t))).filter(|(a, b)| a != b).collect();
        v.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        v
    };

    // 2) Yeni jar
    let stem = file.trim_end_matches(".jar");
    let out_name = if stem.ends_with("-ashi-fix") { file.to_string() } else { format!("{stem}-ashi-fix.jar") };
    let tmp = mods_dir.join(format!("{out_name}.tmp"));
    let mut w = zip::ZipWriter::new(std::fs::File::create(&tmp)?);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let (mut renamed, mut classes, mut texts) = (0, 0, 0);
    let mut examples = vec![];
    let mut seen = BTreeSet::new();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        let name = f.name().to_string();
        if f.is_dir() {
            continue;
        }
        let mut data = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut data)?;
        drop(f);
        // İmzalı jar imzaları değişen içerikle geçersiz olur; atılır
        if name.starts_with("META-INF/") && [".SF", ".RSA", ".DSA", ".EC"].iter().any(|e| name.ends_with(e)) {
            continue;
        }
        let mut new_name = name.clone();
        if name.starts_with("assets/") {
            let mut parts: Vec<String> = name.split('/').map(String::from).collect();
            for p in parts.iter_mut().skip(2) {
                if !valid(p) {
                    *p = translit(p);
                }
            }
            new_name = parts.join("/");
            if new_name != name {
                renamed += 1;
                if examples.len() < 8 {
                    examples.push((name.clone(), new_name.clone()));
                }
            }
        }
        if name.ends_with(".class") {
            if let Some(p) = patch_class(&data, &pairs) {
                data = p;
                classes += 1;
            }
        } else if TEXT_EXT.iter().any(|e| name.ends_with(e)) {
            if let Ok(s) = std::str::from_utf8(&data) {
                let mut t = s.to_string();
                for (a, b) in &pairs {
                    t = t.replace(a.as_str(), b);
                }
                if t != s {
                    data = t.into_bytes();
                    texts += 1;
                }
            }
        }
        // Aynı ada düşen iki dosya olursa ilki kalır
        if !seen.insert(new_name.clone()) {
            continue;
        }
        w.start_file(new_name, opts)?;
        w.write_all(&data)?;
    }
    w.finish()?;

    if renamed + classes + texts == 0 {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::msg(crate::i18n::t("Değiştirilecek bir şey bulunamadı")));
    }
    // 3) Orijinali yedekle, düzeltilmişi yerine koy
    let backup = format!("{file}{BACKUP_SUFFIX}");
    crate::util::retry(|| std::fs::rename(&src, mods_dir.join(&backup))).map_err(|e| crate::error::AppError::at(std::path::Path::new(&src), e))?;
    crate::util::retry(|| std::fs::rename(&tmp, mods_dir.join(&out_name))).map_err(|e| crate::error::AppError::at(std::path::Path::new(&tmp), e))?;
    Ok(FixReport { file: out_name, backup, renamed, patched_classes: classes, patched_files: texts, examples })
}

/// Onarımı geri al: düzeltilmiş jar silinir, yedek eski adıyla geri gelir
pub fn undo(mods_dir: &Path, fixed: &str, backup: &str) -> Result<()> {
    for f in [fixed, backup] {
        if f.contains(['/', '\\']) || f.contains("..") {
            return Err(AppError::msg(crate::i18n::t("Geçersiz dosya")));
        }
    }
    let orig = backup.strip_suffix(BACKUP_SUFFIX).ok_or_else(|| AppError::msg(crate::i18n::t("Yedek bulunamadı")))?;
    let b = mods_dir.join(backup);
    if !b.is_file() {
        return Err(AppError::msg(crate::i18n::t("Yedek bulunamadı")));
    }
    let _ = std::fs::remove_file(mods_dir.join(fixed));
    crate::util::retry(|| std::fs::rename(&b, mods_dir.join(orig))).map_err(|e| crate::error::AppError::at(std::path::Path::new(&b), e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Elle yazılmış küçük bir sınıf: sabit havuzunda bir sınıf adı ve bir dosya yolu
    fn class_with(path: &str) -> Vec<u8> {
        let mut b = vec![0xCA, 0xFE, 0xBA, 0xBE, 0, 0, 0, 65];
        let utf = |b: &mut Vec<u8>, s: &str| {
            b.push(1);
            b.extend_from_slice(&(s.len() as u16).to_be_bytes());
            b.extend_from_slice(s.as_bytes());
        };
        b.extend_from_slice(&7u16.to_be_bytes()); // 6 girdi
        utf(&mut b, "com/example/Foo"); // #1
        b.extend_from_slice(&[7, 0, 1]); // #2 Class → #1
        utf(&mut b, "java/lang/Object"); // #3
        b.extend_from_slice(&[7, 0, 3]); // #4
        b.extend_from_slice(&[5, 0, 0, 0, 0, 0, 0, 0, 42]); // #5-6 long
        // Yol, long'dan sonra (iki yuva atlamasını da sınar)
        let mut tail = vec![];
        utf(&mut tail, path);
        // Sayıyı 8'e çıkar (#7 = yol)
        b[8..10].copy_from_slice(&8u16.to_be_bytes());
        b.extend_from_slice(&tail);
        b.extend_from_slice(&[0, 0x21, 0, 2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
        b
    }

    #[test]
    fn translit_and_tokens() {
        assert_eq!(translit("element_fıre"), "element_fire");
        assert_eq!(translit("Şövalye Kılıcı"), "sovalye_kilici");
        assert_eq!(bad_tokens("example:textures/gui/element_fıre.png"), vec!["element_fıre"]);
    }

    #[test]
    fn class_patch_keeps_structure() {
        let c = class_with("textures/gui/element_fıre.png");
        let pairs = vec![("element_fıre".to_string(), "element_fire".to_string())];
        let p = patch_class(&c, &pairs).unwrap();
        let s = String::from_utf8_lossy(&p);
        assert!(s.contains("textures/gui/element_fire.png"));
        assert!(s.contains("com/example/Foo"));
        // 'ı' 2 bayt, 'i' 1 bayt: dosya 1 bayt kısalır, kuyruk aynı kalır
        assert_eq!(p.len(), c.len() - 1);
        assert_eq!(&p[p.len() - 14..], &c[c.len() - 14..]);
        // Büyük harfli parçalar sınıf adlarında değişmez
        let pairs = vec![("Foo".to_string(), "foo".to_string())];
        assert!(patch_class(&class_with("textures/x.png"), &pairs).is_none());
    }

    #[test]
    fn fixes_jar_and_undo() {
        let dir = std::env::temp_dir().join(format!("west-fix-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(dir.join("wand.jar")).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("fabric.mod.json", o).unwrap();
            z.write_all(br#"{"id":"wand"}"#).unwrap();
            z.start_file("com/example/Foo.class", o).unwrap();
            z.write_all(&class_with("textures/gui/element_fıre.png")).unwrap();
            z.start_file("assets/example/textures/gui/element_fıre.png", o).unwrap();
            z.write_all(b"png").unwrap();
            z.start_file("assets/example/models/item/wand.json", o).unwrap();
            z.write_all("{\"textures\":{\"layer0\":\"example:gui/element_fıre\"}}".as_bytes()).unwrap();
            z.finish().unwrap();
        }
        let r = fix_bad_paths(&dir, "wand.jar", Some("example:textures/gui/element_fıre.png")).unwrap();
        assert_eq!(r.file, "wand-ashi-fix.jar");
        assert_eq!((r.renamed, r.patched_classes, r.patched_files), (1, 1, 1));
        assert!(dir.join("wand.jar.ashi-orijinal").is_file());
        assert!(!dir.join("wand.jar").exists());
        let mut z = zip::ZipArchive::new(std::fs::File::open(dir.join("wand-ashi-fix.jar")).unwrap()).unwrap();
        assert!(z.by_name("assets/example/textures/gui/element_fire.png").is_ok());
        let mut j = String::new();
        z.by_name("assets/example/models/item/wand.json").unwrap().read_to_string(&mut j).unwrap();
        assert!(j.contains("gui/element_fire"));
        undo(&dir, &r.file, &r.backup).unwrap();
        assert!(dir.join("wand.jar").is_file());
        assert!(!dir.join("wand-ashi-fix.jar").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod real {
    /// Gerçek bir javac çıktısıyla dene: WEST_FIX_DIR=<mods klasörü> cargo test real_jar -- --ignored
    #[test]
    #[ignore]
    fn real_jar() {
        let dir = std::path::PathBuf::from(std::env::var("WEST_FIX_DIR").unwrap());
        let r = super::fix_bad_paths(&dir, "wand.jar", Some("example:textures/gui/element_fıre.png")).unwrap();
        println!("{r:?}");
    }
}
