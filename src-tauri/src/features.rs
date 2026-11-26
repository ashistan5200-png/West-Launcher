//! Kolaylaştırıcılar:
//! - Sunucuya göre hazırla: sunucuyu sorgular (Server List Ping), sürümünü ve (Forge/NeoForge ise) mod listesini
//!   okur; o sürümde bir instance kurar, bulabildiği modları Modrinth'ten indirir ve sunucuyu listeye ekler.
//! - FPS paketi: yükleyiciye uygun performans modlarını (Sodium, Lithium, FerriteCore…) tek seferde kurar.
//! - Kurmadan önce uyumluluk: bir modu eklemeden önce çakışan/uyumsuz modları ve sürüm sorununu söyler.
//! - Otomatik dünya yedeği: oyun kapanınca o oturumda değişen dünyaları yedekler.
//! - "Neden kasıyor?": oyundan gelen oturum ölçümlerini saklar ve yorumlar.

use crate::content::{load_index, modrinth, Kind, Source};
use crate::error::{AppError, Result};
use crate::instance::{Instance, InstanceManager, Loader, LoaderKind, NewInstance};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// ───────────────────────── Sunucu sorgusu ─────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerProbe {
    pub address: String,
    pub version_name: String,
    pub protocol: i64,
    /// Sunucunun sürüm adından çıkarılan Minecraft sürümü (ör. "Paper 1.21.4" → "1.21.4")
    pub mc_version: Option<String>,
    pub motd: String,
    pub online: i64,
    pub max: i64,
    /// Forge/NeoForge sunucusuysa yükleyici
    pub loader: Option<String>,
    /// Sunucunun bildirdiği mod kimlikleri (Forge/NeoForge)
    pub mods: Vec<String>,
    pub favicon: Option<String>,
}

fn put_varint(buf: &mut Vec<u8>, mut v: i32) {
    loop {
        let mut b = (v & 0x7F) as u8;
        v = ((v as u32) >> 7) as i32;
        if v != 0 {
            b |= 0x80;
        }
        buf.push(b);
        if v == 0 {
            break;
        }
    }
}

async fn read_varint(s: &mut tokio::net::TcpStream) -> Result<i32> {
    let mut out = 0i32;
    for i in 0..5 {
        let b = s.read_u8().await?;
        out |= ((b & 0x7F) as i32) << (7 * i);
        if b & 0x80 == 0 {
            return Ok(out);
        }
    }
    Err(AppError::msg("geçersiz yanıt"))
}

fn split_address(address: &str) -> Result<(String, u16)> {
    let a = address.trim().trim_start_matches("minecraft://");
    if a.is_empty() || a.contains(['/', ' ']) {
        return Err(AppError::msg(crate::i18n::t("Geçerli bir sunucu adresi yaz (ör. play.ornek.com)")));
    }
    match a.rsplit_once(':') {
        Some((h, p)) if !h.contains(':') => Ok((h.to_string(), p.parse().map_err(|_| AppError::msg(crate::i18n::t("Port sayı olmalı")))?)),
        _ => Ok((a.to_string(), 25565)),
    }
}

fn motd_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Object(o) => {
            let mut s = o.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
            if let Some(Value::Array(extra)) = o.get("extra") {
                for e in extra {
                    s.push_str(&motd_text(e));
                }
            }
            s
        }
        Value::Array(a) => a.iter().map(motd_text).collect(),
        _ => String::new(),
    }
}

/// "§a" biçim kodlarını atar
fn strip_codes(s: &str) -> String {
    let mut out = String::new();
    let mut skip = false;
    for c in s.chars() {
        if skip {
            skip = false;
            continue;
        }
        if c == '§' {
            skip = true;
            continue;
        }
        out.push(c);
    }
    out.trim().to_string()
}

/// Sürüm metnindeki en yüksek "1.21.4" / "26.2" benzeri sürüm
pub fn version_in(text: &str) -> Option<String> {
    let mut best: Option<(Vec<u32>, String)> = None;
    for tok in text.split(|c: char| !(c.is_ascii_digit() || c == '.' || c == 'x' || c == 'X')) {
        let tok = tok.trim_matches('.').trim_end_matches(['x', 'X']).trim_end_matches('.');
        let parts: Vec<&str> = tok.split('.').collect();
        if parts.len() < 2 || parts.iter().any(|p| p.is_empty() || p.len() > 3 || !p.chars().all(|c| c.is_ascii_digit())) {
            continue;
        }
        let nums: Vec<u32> = parts.iter().filter_map(|p| p.parse().ok()).collect();
        // Minecraft sürümleri ya 1.x (1.7 ve sonrası) ya da yıl tabanlı (25.x, 26.x…); "Velocity 3.3.0" gibi proxy sürümleri atlanır
        let mc_like = (nums[0] == 1 && nums[1] >= 7 && nums[1] < 40) || (24..=60).contains(&nums[0]);
        if !mc_like {
            continue;
        }
        if best.as_ref().map(|(b, _)| nums > *b).unwrap_or(true) {
            best = Some((nums, tok.to_string()));
        }
    }
    best.map(|(_, s)| s)
}

pub async fn probe(address: &str) -> Result<ServerProbe> {
    let (host, port) = split_address(address)?;
    let mut s = tokio::time::timeout(Duration::from_secs(6), tokio::net::TcpStream::connect((host.as_str(), port)))
        .await
        .map_err(|_| AppError::msg(crate::i18n::t("Sunucu yanıt vermedi")))?
        .map_err(|_| AppError::msg(crate::i18n::t("Sunucuya bağlanılamadı; adresi kontrol et")))?;
    let mut hs = Vec::new();
    put_varint(&mut hs, 0x00);
    put_varint(&mut hs, -1);
    put_varint(&mut hs, host.len() as i32);
    hs.extend_from_slice(host.as_bytes());
    hs.extend_from_slice(&port.to_be_bytes());
    put_varint(&mut hs, 1);
    let mut pkt = Vec::new();
    put_varint(&mut pkt, hs.len() as i32);
    pkt.extend_from_slice(&hs);
    pkt.extend_from_slice(&[0x01, 0x00]);
    s.write_all(&pkt).await?;
    let json = tokio::time::timeout(Duration::from_secs(8), async {
        let _len = read_varint(&mut s).await?;
        let _id = read_varint(&mut s).await?;
        let n = read_varint(&mut s).await? as usize;
        if n > 4 * 1024 * 1024 {
            return Err(AppError::msg("geçersiz yanıt"));
        }
        let mut buf = vec![0u8; n];
        s.read_exact(&mut buf).await?;
        Ok::<_, AppError>(buf)
    })
    .await
    .map_err(|_| AppError::msg(crate::i18n::t("Sunucu yanıt vermedi")))??;
    let v: Value = serde_json::from_slice(&json)?;
    let version_name = v["version"]["name"].as_str().unwrap_or("").to_string();
    let mut mods = Vec::new();
    let mut loader = None;
    // Forge 1.13+ / NeoForge: "forgeData"; eski Forge: "modinfo"
    if let Some(fd) = v.get("forgeData") {
        loader = Some(if version_name.to_lowercase().contains("neoforge") || fd["fmlNetworkVersion"].as_i64().unwrap_or(0) >= 4 { "neoforge" } else { "forge" }.to_string());
        for m in fd["mods"].as_array().into_iter().flatten() {
            if let Some(id) = m["modId"].as_str().or(m["modid"].as_str()) {
                mods.push(id.to_string());
            }
        }
    } else if v["modinfo"]["type"].as_str() == Some("FML") {
        loader = Some("forge".into());
        for m in v["modinfo"]["modList"].as_array().into_iter().flatten() {
            if let Some(id) = m["modid"].as_str() {
                mods.push(id.to_string());
            }
        }
    }
    if version_name.to_lowercase().contains("neoforge") {
        loader = Some("neoforge".into());
    }
    mods.retain(|m| !["minecraft", "forge", "neoforge", "fml", "mcp", "javafml"].contains(&m.as_str()));
    Ok(ServerProbe {
        address: if port == 25565 { host.clone() } else { format!("{host}:{port}") },
        mc_version: version_in(&version_name),
        version_name: strip_codes(&version_name),
        protocol: v["version"]["protocol"].as_i64().unwrap_or(0),
        motd: strip_codes(&motd_text(&v["description"])),
        online: v["players"]["online"].as_i64().unwrap_or(0),
        max: v["players"]["max"].as_i64().unwrap_or(0),
        loader,
        mods,
        favicon: v["favicon"].as_str().map(String::from),
    })
}

/// "1.21" gibi eksik sürümü Mojang listesindeki en yeni uygun sürüme çevirir
async fn resolve_mc(state: &AppState, wanted: &str) -> Result<String> {
    let m = crate::core::manifest::fetch_manifest(&state.http, &state.paths).await?;
    if m.versions.iter().any(|v| v.id == wanted) {
        return Ok(wanted.to_string());
    }
    m.versions
        .iter()
        .filter(|v| v.kind == "release")
        .find(|v| v.id.starts_with(&format!("{wanted}.")))
        .map(|v| v.id.clone())
        .ok_or_else(|| AppError::msg(crate::i18n::tf("Minecraft {0} bulunamadı", &[&wanted])))
}

/// servers.dat (sıkıştırılmamış NBT): tek bir sunucu kaydı
fn servers_dat(name: &str, ip: &str) -> Vec<u8> {
    fn s(out: &mut Vec<u8>, v: &str) {
        out.extend_from_slice(&(v.len() as u16).to_be_bytes());
        out.extend_from_slice(v.as_bytes());
    }
    let mut o = vec![0x0A];
    s(&mut o, "");
    o.push(0x09);
    s(&mut o, "servers");
    o.push(0x0A);
    o.extend_from_slice(&1i32.to_be_bytes());
    o.push(0x08);
    s(&mut o, "name");
    s(&mut o, name);
    o.push(0x08);
    s(&mut o, "ip");
    s(&mut o, ip);
    o.push(0x00);
    o.push(0x00);
    o
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerPrepResult {
    pub instance: Instance,
    pub probe: ServerProbe,
    pub installed: Vec<String>,
    pub missing: Vec<String>,
}

pub async fn server_prep(state: &AppState, address: &str, name: Option<String>, progress: crate::core::ProgressFn) -> Result<ServerPrepResult> {
    let pr = probe(address).await?;
    let wanted = pr.mc_version.clone().ok_or_else(|| AppError::msg(crate::i18n::tf("Sunucunun Minecraft sürümü anlaşılamadı ({0})", &[&pr.version_name])))?;
    let mc = resolve_mc(state, &wanted).await?;
    let kind = match pr.loader.as_deref() {
        Some("neoforge") => LoaderKind::NeoForge,
        Some("forge") => LoaderKind::Forge,
        _ => LoaderKind::Vanilla,
    };
    let host = pr.address.split(':').next().unwrap_or(&pr.address).to_string();
    let inst = InstanceManager::new(&state.paths).create(NewInstance {
        name: name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| host.clone()),
        mc_version: mc.clone(),
        loader: Loader { kind, version: None },
        icon: None,
        group: Some(crate::i18n::t("Sunucular")),
    })?;
    let game = state.paths.instance_game_dir(&inst.id);
    std::fs::create_dir_all(&game)?;
    std::fs::write(game.join("servers.dat"), servers_dat(&host, &pr.address))?;

    let (mut installed, mut missing) = (Vec::new(), Vec::new());
    if kind != LoaderKind::Vanilla {
        let loader = crate::commands::content::loader_slug(kind);
        for (i, modid) in pr.mods.iter().enumerate() {
            progress(crate::core::Progress {
                task: format!("server-{}", inst.id),
                stage: "files".into(),
                current: i as u64,
                total: pr.mods.len() as u64,
                message: Some(crate::i18n::tf("{0} aranıyor", &[modid])),
            });
            // Mod kimliği çoğu zaman Modrinth adresiyle aynıdır (ör. "create", "jei")
            let ok = match modrinth::project_detail(&state.http, &modid.replace('_', "-")).await {
                Ok(p) if p["client_side"].as_str() != Some("unsupported") => {
                    let pid = p["id"].as_str().unwrap_or_default().to_string();
                    let ctx = crate::content::install::InstallCtx {
                        http: &state.http,
                        cf_key: None,
                        instance_id: &inst.id,
                        instance_dir: state.paths.instance_dir(&inst.id),
                        game_dir: game.clone(),
                        mc_version: mc.clone(),
                        loader: loader.clone(),
                        progress: progress.clone(),
                    };
                    crate::content::install::install(&ctx, Source::Modrinth, &pid, Kind::Mod).await.is_ok()
                }
                Ok(_) => true, // yalnızca sunucuda çalışan mod: istemciye gerekmez
                Err(_) => false,
            };
            if ok { installed.push(modid.clone()) } else { missing.push(modid.clone()) }
        }
    }
    Ok(ServerPrepResult { instance: inst, probe: pr, installed, missing })
}

// ───────────────────────── FPS paketi ─────────────────────────

/// (Modrinth adresi, görünen ad, ne işe yarar)
const FPS_COMMON: &[(&str, &str, &str)] = &[
    ("sodium", "Sodium", "Çizim motorunu baştan yazar; FPS'i katlar"),
    ("ferrite-core", "FerriteCore", "Bellek kullanımını düşürür"),
    ("entityculling", "Entity Culling", "Görünmeyen varlıkları çizmez"),
    ("immediatelyfast", "ImmediatelyFast", "Arayüz ve yazı çizimini hızlandırır"),
    ("modernfix", "ModernFix", "Açılışı ve belleği iyileştirir"),
    ("dynamic-fps", "Dynamic FPS", "Oyun arkadayken FPS'i düşürür, pil ve ısı tasarrufu"),
];
const FPS_FABRIC: &[(&str, &str, &str)] = &[("lithium", "Lithium", "Oyun mantığını (tick) hızlandırır"), ("moreculling", "More Culling", "Gizli blok yüzeylerini atlar")];
/// Sodium'la çakışanlar: bunlardan biri kuruluysa Sodium kurulmaz
const SODIUM_RIVALS: &[&str] = &["embeddium", "rubidium", "optifine", "optifabric", "magnesium"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FpsItem {
    pub slug: String,
    pub title: String,
    pub why: String,
    /// "installed" | "install" | "skip"
    pub status: String,
    pub note: Option<String>,
}

pub async fn fps_plan(state: &AppState, inst: &Instance) -> Result<Vec<FpsItem>> {
    let loader = crate::commands::content::loader_slug(inst.loader.kind).ok_or_else(|| AppError::msg(crate::i18n::t("FPS paketi için bir mod yükleyici (Fabric, NeoForge…) gerekir; vanilla instance'a mod kurulamaz.")))?;
    let index = load_index(&state.paths.instance_dir(&inst.id));
    let titles: Vec<String> = index.iter().map(|c| c.title.to_lowercase()).collect();
    let has = |name: &str| titles.iter().any(|t| t.replace([' ', '-'], "") == name.replace([' ', '-'], "").to_lowercase());
    let mut list: Vec<&(&str, &str, &str)> = FPS_COMMON.iter().collect();
    if matches!(inst.loader.kind, LoaderKind::Fabric | LoaderKind::Quilt) {
        list.extend(FPS_FABRIC.iter());
    }
    let mut out = Vec::new();
    for (slug, title, why) in list {
        let mut item = FpsItem { slug: slug.to_string(), title: title.to_string(), why: crate::i18n::t(why), status: "install".into(), note: None };
        if has(title) || index.iter().any(|c| c.title.eq_ignore_ascii_case(slug)) {
            item.status = "installed".into();
        } else if *slug == "sodium" && SODIUM_RIVALS.iter().any(|r| has(r)) {
            item.status = "skip".into();
            item.note = Some(crate::i18n::t("Kurulu başka bir çizim modu (Embeddium/OptiFine) ile çakışır"));
        } else if modrinth::best_version(&state.http, slug, &inst.mc_version, Some(&loader)).await.is_err() {
            item.status = "skip".into();
            item.note = Some(crate::i18n::tf("{0} {1} için sürümü yok", &[&loader_label(inst.loader.kind), &inst.mc_version]));
        }
        out.push(item);
    }
    Ok(out)
}

fn loader_label(k: LoaderKind) -> &'static str {
    match k {
        LoaderKind::Vanilla => "Vanilla",
        LoaderKind::Fabric => "Fabric",
        LoaderKind::Quilt => "Quilt",
        LoaderKind::Forge => "Forge",
        LoaderKind::NeoForge => "NeoForge",
    }
}

// ───────────────────────── Kurmadan önce uyumluluk ─────────────────────────

/// Birbiriyle aynı anda çalışmayan bilinen mod çiftleri (görünen adlarıyla)
const CONFLICTS: &[(&str, &[&str])] = &[
    ("sodium", &["embeddium", "rubidium", "optifine", "magnesium"]),
    ("embeddium", &["sodium", "rubidium", "optifine"]),
    ("iris", &["oculus", "optifine"]),
    ("oculus", &["iris", "optifine"]),
    ("lithium", &["canary", "radium"]),
    ("optifine", &["sodium", "embeddium", "iris", "oculus"]),
    ("starlight", &["phosphor"]),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Precheck {
    /// Kurulumu engelleyen ya da sorun çıkaracak durumlar
    pub problems: Vec<String>,
    /// Bilgi: birlikte kurulacak bağımlılıklar vb.
    pub notes: Vec<String>,
    pub version: Option<String>,
}

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

pub async fn precheck(state: &AppState, inst: &Instance, project_id: &str, title: &str) -> Result<Precheck> {
    let loader = crate::commands::content::loader_slug(inst.loader.kind);
    let index = load_index(&state.paths.instance_dir(&inst.id));
    let mut out = Precheck { problems: vec![], notes: vec![], version: None };
    if index.iter().any(|c| c.project_id == project_id) {
        out.notes.push(crate::i18n::t("Bu içerik zaten kurulu; yeniden kurulursa en son uyumlu sürüm gelir."));
    }
    match modrinth::best_version(&state.http, project_id, &inst.mc_version, loader.as_deref()).await {
        Ok(v) => {
            out.version = Some(v.version_number.clone());
            if v.version_type != "release" {
                out.notes.push(crate::i18n::tf("Uyumlu tek sürüm {0} aşamasında; hata içerebilir.", &[&v.version_type]));
            }
            let mut deps = 0;
            for d in &v.dependencies {
                let Some(pid) = d.project_id.as_deref() else { continue };
                match d.dependency_type.as_str() {
                    "incompatible" => {
                        if let Some(c) = index.iter().find(|c| c.project_id == pid) {
                            out.problems.push(crate::i18n::tf("Kurulu \"{0}\" ile uyumsuz olduğunu bildiriyor.", &[&c.title]));
                        }
                    }
                    "required" if !index.iter().any(|c| c.project_id == pid) => deps += 1,
                    _ => {}
                }
            }
            if deps > 0 {
                out.notes.push(crate::i18n::tf("{0} gerekli kütüphane de birlikte kurulacak.", &[&deps]));
            }
        }
        Err(_) => out.problems.push(crate::i18n::tf("{0} {1} için uyumlu sürümü yok.", &[&loader_label(inst.loader.kind), &inst.mc_version])),
    }
    let me = norm(title);
    for (a, rivals) in CONFLICTS {
        if me.starts_with(a) {
            for c in &index {
                let n = norm(&c.title);
                if rivals.iter().any(|r| n.starts_with(r)) {
                    out.problems.push(crate::i18n::tf("Kurulu \"{0}\" ile aynı işi yapar; ikisi birlikte çalışmaz.", &[&c.title]));
                }
            }
        }
    }
    out.problems.dedup();
    Ok(out)
}

// ───────────────────────── Otomatik dünya yedeği ─────────────────────────

/// Oyun kapanınca çağrılır: oturum süresince değişen dünyaları yedekler (arka planda)
pub fn backup_changed_worlds(state: &AppState, instance_id: &str, session_secs: u64) {
    let s = state.settings.read();
    if !s.backup_on_exit || session_secs < 30 {
        return;
    }
    let keep = s.backup_keep.max(1);
    let base = s.backup_dir.clone().map(std::path::PathBuf::from).unwrap_or_else(|| state.paths.backups()).join(instance_id);
    drop(s);
    let game = state.paths.instance_game_dir(instance_id);
    let since = std::time::SystemTime::now() - Duration::from_secs(session_secs + 60);
    std::thread::spawn(move || {
        let Ok(rd) = std::fs::read_dir(game.join("saves")) else { return };
        for e in rd.flatten() {
            let level = e.path().join("level.dat");
            let changed = std::fs::metadata(&level).and_then(|m| m.modified()).map(|t| t >= since).unwrap_or(false);
            if changed {
                let folder = e.file_name().to_string_lossy().to_string();
                match crate::content::manage::backup_world(&game, &base, &folder, keep) {
                    Ok(p) => tracing::info!("otomatik yedek: {p}"),
                    Err(err) => tracing::warn!("otomatik yedek alınamadı ({folder}): {err}"),
                }
            }
        }
    });
}

// ───────────────────────── "Neden kasıyor?" ─────────────────────────

/// Oyundan (West Companion) gelen bir oturumun ölçümleri
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PerfSession {
    pub at: i64,
    pub seconds: u64,
    pub fps_avg: f32,
    /// En kötü %1 karelerin ortalama FPS'i
    pub fps_low1: f32,
    pub fps_min: f32,
    /// 100 ms'den uzun süren kare sayısı
    pub stutters: u32,
    pub mem_peak_pct: f32,
    pub mem_max_mb: u32,
    pub render_distance: u32,
    pub shaders: bool,
    pub mods: u32,
    pub in_world_secs: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfFinding {
    /// "bad" | "warn" | "ok"
    pub tone: String,
    pub title: String,
    pub text: String,
    /// Önerilen eylem: "fps-pack" | "memory" | "render-distance" | null
    pub action: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfReport {
    pub sessions: Vec<PerfSession>,
    pub findings: Vec<PerfFinding>,
}

fn perf_path(state: &AppState, id: &str) -> std::path::PathBuf {
    state.paths.instance_dir(id).join("perf.json")
}

pub fn perf_record(state: &AppState, id: &str, s: PerfSession) -> Result<()> {
    let p = perf_path(state, id);
    let mut list: Vec<PerfSession> = std::fs::read(&p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    list.push(PerfSession { at: chrono::Utc::now().timestamp(), ..s });
    let n = list.len();
    if n > 10 {
        list.drain(0..n - 10);
    }
    crate::util::write_json_atomic(&p, &list)
}

pub fn perf_report(state: &AppState, inst: &Instance) -> PerfReport {
    let sessions: Vec<PerfSession> = std::fs::read(perf_path(state, &inst.id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let mut f = Vec::new();
    let Some(last) = sessions.iter().rev().find(|s| s.in_world_secs >= 20) else {
        return PerfReport { sessions, findings: f };
    };
    let index = load_index(&state.paths.instance_dir(&inst.id));
    let has_sodium = index.iter().any(|c| { let n = norm(&c.title); n.starts_with("sodium") || n.starts_with("embeddium") });
    let mk = |tone: &str, title: String, text: String, action: Option<&str>| PerfFinding { tone: tone.into(), title, text, action: action.map(String::from) };

    if last.mem_peak_pct >= 90.0 {
        f.push(mk("bad", crate::i18n::t("Bellek yetmiyor"), crate::i18n::tf("Ayrılan belleğin %{0}'i doldu ({1} MB). Bu, düzenli takılmaların en sık sebebi. Instance ayarlarından belleği artır.", &[&(last.mem_peak_pct.round() as u32), &last.mem_max_mb]), Some("memory")));
    } else if last.mem_peak_pct >= 80.0 {
        f.push(mk("warn", crate::i18n::t("Bellek sınırda"), crate::i18n::tf("Ayrılan belleğin %{0}'i kullanıldı. Büyük dünyalarda takılma yapabilir.", &[&(last.mem_peak_pct.round() as u32)]), Some("memory")));
    }
    if !has_sodium && inst.loader.kind != LoaderKind::Vanilla && last.fps_avg < 90.0 {
        f.push(mk("warn", crate::i18n::t("Performans modu yok"), crate::i18n::t("Sodium ve benzeri modlar çoğu bilgisayarda FPS'i iki katına çıkarır. FPS paketi tek tıkla kurar."), Some("fps-pack")));
    }
    if last.stutters >= 20 && last.fps_low1 < last.fps_avg * 0.35 {
        f.push(mk("bad", crate::i18n::t("Sık takılma"), crate::i18n::tf("Oturumda {0} kez 100 ms'den uzun donma oldu; en kötü anlarda FPS {1}'e düştü.", &[&last.stutters, &(last.fps_low1.round() as u32)]), if last.mem_peak_pct >= 80.0 { Some("memory") } else { None }));
    }
    if last.render_distance > 16 && last.fps_avg < 60.0 {
        f.push(mk("warn", crate::i18n::t("Görüş mesafesi yüksek"), crate::i18n::tf("Görüş mesafesi {0} parça. 12'ye indirmek FPS'i belirgin artırır.", &[&last.render_distance]), Some("render-distance")));
    }
    if last.shaders && last.fps_avg < 45.0 {
        f.push(mk("warn", crate::i18n::t("Shader açık"), crate::i18n::t("Shader'lar en ağır yük. Daha hafif bir profil seç ya da kapat."), None));
    }
    if last.mods > 150 && last.fps_avg < 60.0 {
        f.push(mk("warn", crate::i18n::t("Çok sayıda mod"), crate::i18n::tf("{0} mod yüklü. Kullanmadıklarını kapatmak açılışı ve FPS'i iyileştirir.", &[&last.mods]), None));
    }
    if f.is_empty() {
        f.push(mk("ok", crate::i18n::t("Her şey yolunda"), crate::i18n::tf("Ortalama {0} FPS, en kötü anlarda {1} FPS. Belirgin bir sorun görünmüyor.", &[&(last.fps_avg.round() as u32), &(last.fps_low1.round() as u32)]), None));
    }
    PerfReport { sessions, findings: f }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_from_server_names() {
        assert_eq!(version_in("Paper 1.21.4").as_deref(), Some("1.21.4"));
        assert_eq!(version_in("Velocity 3.3.0 1.8.x-1.21.x").as_deref(), Some("1.21"));
        assert_eq!(version_in("1.20.1").as_deref(), Some("1.20.1"));
        assert_eq!(version_in("26.2").as_deref(), Some("26.2"));
        assert_eq!(version_in("Requires MC 1.8 / 1.20.6").as_deref(), Some("1.20.6"));
        assert_eq!(version_in("BungeeCord"), None);
    }

    #[test]
    fn address_parsing() {
        assert_eq!(split_address("play.ornek.com").unwrap(), ("play.ornek.com".into(), 25565));
        assert_eq!(split_address("1.2.3.4:25570").unwrap(), ("1.2.3.4".into(), 25570));
        assert!(split_address("a b").is_err());
    }

    /// Gerçek protokolü konuşan yerel sahte sunucu: el sıkışma + durum isteği → JSON
    #[tokio::test]
    async fn probe_reads_status_and_forge_mods() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = [0u8; 256];
            let _ = s.read(&mut buf).await.unwrap();
            let json = r#"{"version":{"name":"NeoForge 1.21.1","protocol":767},"players":{"online":3,"max":20},"description":{"text":"§aMerhaba ","extra":[{"text":"dünya"}]},"forgeData":{"fmlNetworkVersion":4,"mods":[{"modId":"minecraft"},{"modId":"create"},{"modId":"jei"}]}}"#;
            let mut body = Vec::new();
            put_varint(&mut body, 0);
            put_varint(&mut body, json.len() as i32);
            body.extend_from_slice(json.as_bytes());
            let mut pkt = Vec::new();
            put_varint(&mut pkt, body.len() as i32);
            pkt.extend_from_slice(&body);
            s.write_all(&pkt).await.unwrap();
        });
        let p = probe(&format!("127.0.0.1:{port}")).await.unwrap();
        assert_eq!(p.mc_version.as_deref(), Some("1.21.1"));
        assert_eq!(p.loader.as_deref(), Some("neoforge"));
        assert_eq!(p.mods, vec!["create", "jei"]);
        assert_eq!(p.motd, "Merhaba dünya");
        assert_eq!((p.online, p.max), (3, 20));
    }

    #[test]
    fn servers_dat_is_valid_nbt_shape() {
        let b = servers_dat("Sunucu", "play.ornek.com");
        assert_eq!(b[0], 0x0A);
        assert_eq!(*b.last().unwrap(), 0x00);
        assert!(b.windows(7).any(|w| w == b"servers"));
    }
}
