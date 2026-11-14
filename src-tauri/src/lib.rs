pub mod accounts;
pub mod assistant;
pub mod commands;
pub mod companion;
pub mod content;
pub mod core;
pub mod discord;
pub mod crash;
pub mod error;
pub mod importer;
pub mod instance;
pub mod java;
pub mod paths;
pub mod screenshots;
pub mod secrets;
pub mod settings;
pub mod skins;
pub mod state;
pub mod util;

use paths::Paths;
use state::AppState;
use tauri::Manager;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let paths = Paths::new(Paths::default_root());
    paths.ensure().expect("veri dizini oluşturulamadı");
    // Launcher bir av sırasında kapandıysa Ashi'nin kapattığı modları geri aç
    crash::bisect::restore_all(&paths.instances());
    let state = AppState::new(paths);
    let effect = state.settings.read().theme.window_effect.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state)
        .setup(move |app| {
            let window = app.get_webview_window("main").expect("main window");
            commands::window::apply_effect(&window, &effect);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ayarlar & sistem
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::get_hardware,
            commands::settings::get_data_dir,
            commands::window::set_window_effect,
            // sürümler
            commands::versions::list_mc_versions,
            commands::versions::list_loader_versions,
            // instance
            commands::instance::list_instances,
            commands::instance::get_instance,
            commands::instance::create_instance,
            commands::instance::update_instance,
            commands::instance::clone_instance,
            commands::instance::make_template,
            commands::instance::create_from_template,
            commands::instance::delete_instance,
            commands::instance::instance_path,
            // java
            commands::java::list_java,
            commands::java::install_java,
            commands::java::preview_jvm,
            // başlatma
            commands::launch::launch_instance,
            commands::launch::kill_instance,
            commands::launch::running_instances,
            commands::launch::get_companion,
            commands::launch::set_companion_config,
            // Ashi — Otomatik Suçlu Avcısı
            commands::ashi::plan_hunt,
            commands::ashi::start_hunt,
            commands::ashi::cancel_hunt,
            commands::ashi::disable_mods,
            commands::ashi::ashi_skin,
            // İçerik: birleşik arama + kurulum
            commands::content::search_content,
            commands::content::install_content,
            commands::content::install_modpack,
            commands::content::installed_content,
            // Ashi asistanı + anahtarlar
            commands::assistant::ashi_chat,
            commands::assistant::secret_status,
            commands::assistant::set_secret,
            commands::assistant::ollama_status,
            commands::assistant::ollama_pull,
            // Hesaplar + skin yöneticisi
            commands::accounts::list_accounts,
            commands::accounts::add_offline_account,
            commands::accounts::set_active_account,
            commands::accounts::remove_account,
            commands::accounts::ms_login_start,
            commands::accounts::ms_login_cancel,
            commands::accounts::apply_skin,
            commands::accounts::account_skin,
            commands::accounts::account_capes,
            commands::accounts::set_account_cape,
            commands::skins::list_skins,
            commands::skins::import_skin_file,
            commands::skins::import_skin_player,
            commands::skins::update_skin,
            commands::skins::delete_skin,
            // Ekran görüntüsü galerisi
            commands::screenshots::list_screenshots,
            commands::screenshots::generate_thumbs,
            commands::screenshots::read_screenshot,
            commands::screenshots::copy_screenshot,
            commands::screenshots::copy_png_bytes,
            commands::screenshots::export_screenshot,
            commands::screenshots::delete_screenshot,
            commands::screenshots::save_screenshot_edit,
            commands::screenshots::screenshots_folder,
            commands::screenshots::export_png,
            // Diğer launcher'lardan aktarım
            commands::importer::detect_launchers,
            commands::importer::detect_launcher_folder,
            commands::importer::import_instance,
        ])
        .run(tauri::generate_context!())
        .expect("West Launcher başlatılamadı");
}
