//! Uçtan uca: instance kur → loader → dosyalar → West Companion → oyunu başlat.
use std::sync::Arc;
use west_lib::{companion, core::{auth::AuthSession, http::Http, install, launch, manifest, noop_progress}, instance::*, java, paths::Paths};
#[tokio::main]
async fn main() {
    let root = std::path::PathBuf::from(std::env::args().nth(1).unwrap());
    let paths = Paths::new(root.clone()); paths.ensure().unwrap();
    let http = Http::new();
    let mgr = InstanceManager::new(&paths);
    let inst = match mgr.list().unwrap().into_iter().next() { Some(i) => i, None => mgr.create(NewInstance{ name:"Test".into(), mc_version:"1.21.1".into(), loader: Loader{kind: LoaderKind::Fabric, version:None}, icon:None, group:None }).unwrap() };
    let t = std::time::Instant::now();
    let vid = loaders::install_loader(&http, &paths, &inst, None, noop_progress()).await.unwrap();
    let v = manifest::resolve_version(&http, &paths, &vid).await.unwrap();
    let libs = install::install_version(&http, &paths, &v, 8, &inst.id, noop_progress()).await.unwrap();
    println!("dosyalar hazır: {:?}", t.elapsed());
    let rep = companion::prepare(&http, &paths, std::path::Path::new("."), &inst, true, noop_progress()).await;
    println!("companion: {:?}", rep);
    let game = paths.instance_game_dir(&inst.id);
    let png = std::fs::read("../src/assets/ashi/ashi-skin.png").unwrap();
    companion::write_skin(&game, Some((&png, true))).unwrap();
    let mut cfg = companion::read_config(&game); cfg.fps_overlay = true; companion::write_config(&game, &cfg).unwrap();
    let natives = paths.instance_natives(&inst.id);
    install::extract_natives(&libs.natives, &natives).unwrap();
    let javas = java::detect(&paths).await;
    let j = java::pick(&javas, 21).expect("java 21").clone();
    let opts = launch::LaunchOptions { java: j.path.clone(), game_dir: game.clone(), natives_dir: natives, memory_mb: 2048, jvm_flags: java::jvm::optimize(21, &java::jvm::hardware(), 2048).flags, extra_jvm_args: vec![], resolution: Some((1280, 720)), auth: AuthSession::offline("AshiWest"), join_server: None };
    let args = launch::build_args(&paths, &v, &libs, &opts).unwrap();
    let log = Arc::new(std::sync::Mutex::new(std::fs::File::create(root.join("game.log")).unwrap()));
    let l2 = log.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let _h = launch::spawn(&j.path, args, &game, Arc::new(move |line, _| { use std::io::Write; let _ = writeln!(l2.lock().unwrap(), "{line}"); }), Arc::new(move |code| { let _ = tx.send(code); })).await.unwrap();
    println!("oyun başlatıldı (pid {})", _h.pid);
    match rx.recv_timeout(std::time::Duration::from_secs(400)) { Ok(c) => println!("oyun kapandı: {:?}", c), Err(_) => println!("oyun hâlâ çalışıyor") }
}
