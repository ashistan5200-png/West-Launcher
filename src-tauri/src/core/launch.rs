use super::auth::AuthSession;
use super::install::ResolvedLibraries;
use super::manifest::{ArgValue, Argument, VersionJson};
use super::rules::{allowed, Features};
use crate::error::{AppError, Result};
use crate::paths::Paths;
use crate::util::{classpath_separator, os_name};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

#[derive(Debug, Clone)]
pub struct LaunchOptions {
    pub java: PathBuf,
    pub game_dir: PathBuf,
    pub natives_dir: PathBuf,
    pub memory_mb: u32,
    /// JVM optimizatöründen gelen GC/performans bayrakları
    pub jvm_flags: Vec<String>,
    /// Kullanıcının instance'a özel ek argümanları
    pub extra_jvm_args: Vec<String>,
    pub resolution: Option<(u32, u32)>,
    pub fullscreen: bool,
    pub auth: AuthSession,
    /// Doğrudan sunucuya bağlan (1.20+ quickPlay, eski sürümlerde --server)
    pub join_server: Option<String>,
}

fn substitute(arg: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = arg.to_string();
    if !out.contains("${") {
        return out;
    }
    for (k, v) in vars {
        let needle = format!("${{{k}}}");
        if out.contains(&needle) {
            out = out.replace(&needle, v);
        }
    }
    out
}

fn expand(args: &[Argument], features: &Features, vars: &HashMap<&str, String>, out: &mut Vec<String>) {
    for a in args {
        match a {
            Argument::Plain(s) => out.push(substitute(s, vars)),
            Argument::Ruled { rules, value } => {
                if !allowed(&Some(rules.clone()), features) {
                    continue;
                }
                match value {
                    ArgValue::One(s) => out.push(substitute(s, vars)),
                    ArgValue::Many(v) => out.extend(v.iter().map(|s| substitute(s, vars))),
                }
            }
        }
    }
}

/// Resmi launcher davranışı: miras alınan client jar, türetilmiş sürümün
/// klasörüne kopyalanır. Modern Forge'un `-DignoreList=${version_name}.jar`
/// mekanizması bu sayede doğru çalışır.
fn ensure_client_jar(paths: &Paths, version: &VersionJson) -> Result<PathBuf> {
    let target = paths.version_jar(&version.id);
    if !target.exists() {
        let src = paths.version_jar(version.client_jar_id());
        if !src.exists() {
            return Err(AppError::NotFound(format!("client jar: {}", src.display())));
        }
        if let Some(p) = target.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(src, &target)?;
    }
    Ok(target)
}

pub fn build_args(paths: &Paths, version: &VersionJson, libs: &ResolvedLibraries, opts: &LaunchOptions) -> Result<Vec<String>> {
    let main_class = version
        .main_class
        .clone()
        .ok_or_else(|| AppError::msg(crate::i18n::t("Sürümde mainClass tanımlı değil")))?;

    let client_jar = ensure_client_jar(paths, version)?;
    let sep = classpath_separator();
    let mut cp: Vec<String> = libs.classpath.iter().map(|p| p.display().to_string()).collect();
    cp.push(client_jar.display().to_string());
    let classpath = cp.join(sep);

    let assets_id = version
        .asset_index
        .as_ref()
        .map(|a| a.id.clone())
        .or_else(|| version.assets.clone())
        .unwrap_or_else(|| "legacy".into());
    let assets_root = paths.assets();
    let virtual_dir = assets_root.join("virtual").join(&assets_id);
    let game_assets = if virtual_dir.exists() { virtual_dir } else { assets_root.clone() };

    let (w, h) = opts.resolution.unwrap_or((854, 480));
    let vars: HashMap<&str, String> = HashMap::from([
        ("auth_player_name", opts.auth.username.clone()),
        ("version_name", version.id.clone()),
        ("game_directory", opts.game_dir.display().to_string()),
        ("assets_root", assets_root.display().to_string()),
        ("game_assets", game_assets.display().to_string()),
        ("assets_index_name", assets_id),
        ("auth_uuid", opts.auth.uuid.clone()),
        ("auth_access_token", opts.auth.access_token.clone()),
        ("auth_session", format!("token:{}:{}", opts.auth.access_token, opts.auth.uuid)),
        ("auth_xuid", opts.auth.xuid.clone().unwrap_or_default()),
        ("clientid", String::new()),
        ("user_type", opts.auth.user_type.clone()),
        ("user_properties", "{}".into()),
        ("version_type", version.kind.clone().unwrap_or_else(|| "release".into())),
        ("natives_directory", opts.natives_dir.display().to_string()),
        ("launcher_name", "WestClient".into()),
        ("launcher_version", env!("CARGO_PKG_VERSION").into()),
        ("classpath", classpath.clone()),
        ("classpath_separator", sep.into()),
        ("library_directory", paths.libraries().display().to_string()),
        ("resolution_width", w.to_string()),
        ("resolution_height", h.to_string()),
    ]);

    let features = Features { is_demo_user: false, has_custom_resolution: opts.resolution.is_some() };
    // Xms = Xmx: yığın oyun sırasında büyümez/küçülmez (yeniden boyutlandırma takılma yapar)
    let mut args = vec![format!("-Xmx{}M", opts.memory_mb), format!("-Xms{}M", opts.memory_mb)];
    args.extend(opts.jvm_flags.iter().cloned());
    args.extend(opts.extra_jvm_args.iter().cloned());

    let mut game_args = Vec::new();
    match &version.arguments {
        Some(a) if !a.jvm.is_empty() => {
            expand(&a.jvm, &features, &vars, &mut args);
            expand(&a.game, &features, &vars, &mut game_args);
        }
        other => {
            // Eski format (<1.13)
            if os_name() == "osx" {
                args.push("-XstartOnFirstThread".into());
            }
            args.push(format!("-Djava.library.path={}", opts.natives_dir.display()));
            args.push("-cp".into());
            args.push(classpath);
            if let Some(a) = other {
                expand(&a.game, &features, &vars, &mut game_args);
            }
            if let Some(legacy) = &version.minecraft_arguments {
                game_args.extend(legacy.split_whitespace().map(|s| substitute(s, &vars)));
            }
        }
    }

    if opts.resolution.is_some() && !game_args.iter().any(|a| a == "--width") {
        game_args.extend(["--width".into(), w.to_string(), "--height".into(), h.to_string()]);
    }
    if opts.fullscreen && !game_args.iter().any(|a| a == "--fullscreen") {
        game_args.push("--fullscreen".into());
    }
    if let Some(world) = opts.join_server.as_deref().and_then(|s| s.strip_prefix("world:")) {
        // Tek oyunculu dünyaya doğrudan gir (oyun içi mod merkezinin "yeniden başlat ve dön" özelliği)
        game_args.extend(["--quickPlaySingleplayer".into(), world.to_string()]);
    } else if let Some(server) = &opts.join_server {
        let modern = version.arguments.as_ref().map(|a| {
            a.game.iter().any(|g| matches!(g, Argument::Ruled { value: ArgValue::Many(v), .. } if v.iter().any(|s| s == "--quickPlayMultiplayer")))
        });
        if modern == Some(true) {
            game_args.extend(["--quickPlayMultiplayer".into(), server.clone()]);
        } else {
            let (host, port) = server.split_once(':').unwrap_or((server.as_str(), "25565"));
            game_args.extend(["--server".into(), host.into(), "--port".into(), port.into()]);
        }
    }

    args.push(main_class);
    args.extend(game_args);
    Ok(args)
}

/// Konsolda erişim token'ını asla göstermemek için.
pub fn redact(args: &[String], token: &str) -> Vec<String> {
    args.iter().map(|a| if !token.is_empty() && token != "0" { a.replace(token, "********") } else { a.clone() }).collect()
}

pub type LogFn = Arc<dyn Fn(String, bool) + Send + Sync>;
pub type ExitFn = Arc<dyn Fn(Option<i32>) + Send + Sync>;

pub struct GameHandle {
    pub pid: u32,
    pub kill: oneshot::Sender<()>,
}

/// Bir kabuk komutu satırını parçalara ayırır (tırnaklar desteklenir)
pub fn split_command(line: &str) -> Vec<String> {
    let mut out = vec![];
    let (mut cur, mut quote, mut any) = (String::new(), None::<char>, false);
    for c in line.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => { quote = Some(c); any = true; }
            (None, c) if c.is_whitespace() => {
                if !cur.is_empty() || any { out.push(std::mem::take(&mut cur)); any = false; }
            }
            (None, c) => cur.push(c),
        }
    }
    if !cur.is_empty() || any { out.push(cur); }
    out
}

/// wrapper: Java'yı saran komut (boşsa doğrudan Java çalışır)
/// Windows: bu Java için "yüksek performanslı ekran kartı" tercihini (Ayarlar → Ekran → Grafik ile aynı yer,
/// yalnızca bu kullanıcı) yazar. Entegre grafikli işlemcilerde Windows Java'yı aksi halde zayıf GPU'da çalıştırabilir.
#[cfg(windows)]
pub fn prefer_dedicated_gpu(java: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let dir = java.parent().map(|d| d.to_path_buf()).unwrap_or_default();
    for exe in [java.to_path_buf(), dir.join("javaw.exe"), dir.join("java.exe")] {
        if !exe.exists() {
            continue;
        }
        let _ = std::process::Command::new("reg")
            .args(["add", r"HKCU\Software\Microsoft\DirectX\UserGpuPreferences", "/v"])
            .arg(&exe)
            .args(["/t", "REG_SZ", "/d", "GpuPreference=2;", "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

#[cfg(not(windows))]
pub fn prefer_dedicated_gpu(_java: &Path) {}

pub async fn spawn(java: &Path, args: Vec<String>, cwd: &Path, wrapper: &str, on_log: LogFn, on_exit: ExitFn) -> Result<GameHandle> {
    prefer_dedicated_gpu(java);
    std::fs::create_dir_all(cwd)?;
    let wrap = split_command(wrapper);
    let mut cmd = match wrap.split_first() {
        Some((prog, rest)) => {
            let mut c = Command::new(prog);
            c.args(rest).arg(java);
            c
        }
        None => Command::new(java),
    };
    cmd.args(&args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let shown = if wrap.is_empty() { java.display().to_string() } else { format!("{} {}", wrap.join(" "), java.display()) };
    let mut child = cmd.spawn().map_err(|e| AppError::msg(crate::i18n::tf("Java başlatılamadı ({0}): {1}", &[&shown, &e])))?;
    let pid = child.id().unwrap_or(0);

    if let Some(out) = child.stdout.take() {
        let log = on_log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                log(l, false);
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let log = on_log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                log(l, true);
            }
        });
    }

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = kill_rx => {
                let _ = child.kill().await;
                Some(-1)
            }
        };
        on_exit(code);
    });

    Ok(GameHandle { pid, kill: kill_tx })
}

#[cfg(test)]
mod hook_tests {
    use super::split_command;
    #[test]
    fn splits_wrapper_commands() {
        assert_eq!(split_command("gamemoderun"), vec!["gamemoderun"]);
        assert_eq!(split_command("  prime-run   mangohud "), vec!["prime-run", "mangohud"]);
        assert_eq!(split_command(r#"env "A B=1" 'x y'"#), vec!["env", "A B=1", "x y"]);
        assert!(split_command("   ").is_empty());
    }
}
