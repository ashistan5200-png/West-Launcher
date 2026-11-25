//! Uçtan uca: gerçek launcher kodu (start_game + köprü + oyun içi mod merkezi + devralma) pencere açmadan.
//! Kullanım: live_handoff <veri-kökü>   (JOIN=world:<klasör> ile doğrudan dünyaya girer)
//! Olaylar (live-relaunched, game-exit …) stdout'a yazılır; oyun xdotool ile sürülür.
use tauri::{Listener, Manager};
use west_lib::commands::launch::{start_game, LaunchMode};
use west_lib::core::auth::AuthSession;
use west_lib::instance::{InstanceManager, Loader, LoaderKind, NewInstance};
use west_lib::paths::Paths;
use west_lib::state::AppState;

fn main() {
    let root = std::path::PathBuf::from(std::env::args().nth(1).expect("veri kökü"));
    let paths = Paths::new(root);
    paths.ensure().unwrap();
    let mut ctx = tauri::generate_context!();
    ctx.config_mut().app.windows.clear();
    tauri::Builder::default()
        .manage(AppState::new(paths))
        .setup(|app| {
            west_lib::livemods::set_app(app.handle());
            for ev in ["live-relaunched", "live-relaunch", "game-exit"] {
                app.listen_any(ev, move |e| println!("[olay] {ev}: {}", e.payload()));
            }
            let h = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let st = h.state::<AppState>();
                let mgr = InstanceManager::new(&st.paths);
                let inst = match mgr.list().unwrap().into_iter().next() {
                    Some(i) => i,
                    None => mgr
                        .create(NewInstance {
                            name: "Handoff".into(),
                            mc_version: std::env::var("MC").unwrap_or_else(|_| "26.2".into()),
                            loader: Loader { kind: LoaderKind::Fabric, version: None },
                            icon: None,
                            group: None,
                        })
                        .unwrap(),
                };
                let rd = h.path().resource_dir();
                println!("[test] resource_dir {:?} → companion {:?}", rd, rd.as_ref().ok().and_then(|d| west_lib::companion::bundled_jar(d, &inst)));
                println!("[test] instance {} -> {}", inst.id, st.paths.instance_game_dir(&inst.id).display());
                let t = std::time::Instant::now();
                match start_game(&h, &inst.id, AuthSession::offline("Tester"), std::env::var("JOIN").ok(), LaunchMode::Play).await {
                    Ok(pid) => println!("[test] başladı pid {pid} ({} ms)", t.elapsed().as_millis()),
                    Err(e) => println!("[test] HATA {e}"),
                }
            });
            Ok(())
        })
        .run(ctx)
        .unwrap();
}
