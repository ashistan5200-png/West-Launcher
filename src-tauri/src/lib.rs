pub mod accounts;
pub mod assistant;
pub mod commands;
pub mod cloud;
pub mod bridge;
pub mod companion;
pub mod content;
pub mod core;
pub mod discord;
pub mod crash;
pub mod error;
pub mod importer;
pub mod instance;
pub mod news;
pub mod java;
pub mod paths;
pub mod screenshots;
pub mod secrets;
pub mod settings;
pub mod skins;
pub mod state;
pub mod updater;
pub mod util;
pub mod i18n;
pub mod livemods;
pub mod restorepoints;
pub mod setshare;

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
            remove_old_install();
            let window = app.get_webview_window("main").expect("main window");
            commands::window::apply_effect(&window, &effect);
            commands::updater::spawn_background(app.handle().clone());
            livemods::set_app(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ayarlar & sistem
            commands::ashi::analyze_crash,
            commands::ashi::fix_mod,
            commands::ashi::undo_fix,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::get_hardware,
            commands::settings::get_data_dir,
            commands::settings::cache_size,
            commands::settings::clear_cache,
            commands::settings::reset_settings,
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
            livemods::livemods_pending,
            livemods::livemods_undo,
            livemods::livemods_retry,
            livemods::livemods_apply,
            livemods::livemods_points,
            livemods::livemods_restore,
            livemods::sets_export,
            livemods::sets_import,
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
            commands::content::content_tags,
            commands::instance::set_instance_image,
            commands::instance::list_modes,
            commands::instance::save_mode,
            commands::instance::apply_mode,
            commands::instance::rename_mode,
            commands::instance::delete_mode,
            commands::files::open_path,
            commands::files::read_instance_text,
            commands::files::write_instance_text,
            commands::files::read_image_data,
            commands::files::save_temp_image,
            commands::content::content_project,
            commands::content::content_versions,
            commands::cloud::west_status,
            commands::cloud::west_username_available,
            commands::cloud::west_signup,
            commands::cloud::west_login,
            commands::cloud::west_logout,
            commands::cloud::west_reset_password,
            commands::cloud::west_api,
            commands::cloud::west_upload,
            commands::content::list_content,
            commands::content::refresh_content,
            commands::content::set_content_enabled,
            commands::content::delete_content,
            commands::content::update_content,
            commands::content::add_content_files,
            commands::content::set_content_version,
            commands::content::port_plan,
            commands::content::port_instance,
            commands::content::list_worlds,
            commands::content::backup_world,
            commands::content::delete_world,
            commands::content::world_backups_dir,
            commands::content::list_logs,
            commands::content::read_log,
            commands::content::list_files,
            commands::content::file_path,
            commands::content::export_mrpack,
            // Ashi asistanı + anahtarlar
            commands::assistant::ashi_chat,
            commands::assistant::secret_status,
            commands::assistant::set_secret,
            commands::assistant::lock_status,
            commands::assistant::set_launcher_password,
            commands::assistant::verify_launcher_password,
            commands::assistant::reset_launcher_lock,
            commands::assistant::ollama_status,
            commands::assistant::ollama_setup,
            // Hesaplar + skin yöneticisi
            commands::accounts::list_accounts,
            commands::accounts::add_offline_account,
            commands::accounts::set_active_account,
            commands::accounts::remove_account,
            commands::accounts::ms_login_start,
            commands::accounts::ms_login_cancel,
            commands::accounts::ms_login_window,
            commands::accounts::apply_skin,
            commands::accounts::account_skin,
            commands::accounts::account_capes,
            commands::accounts::set_account_cape,
            commands::skins::list_skins,
            commands::skins::import_skin_file,
            commands::skins::import_skin_player,
            commands::skins::update_skin,
            commands::skins::delete_skin,
            commands::skins::save_skin_png,
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
            // Uygulama güncellemeleri
            commands::updater::update_status,
            commands::updater::check_update,
            commands::updater::install_update,
            // Haberler
            commands::news::news_patch_notes,
            commands::news::news_patch_body,
            commands::news::news_mod_updates,
            commands::news::news_asset_diff,
            commands::news::news_texture,
            commands::news::news_sound,
            commands::news::news_export,
        ])
        .run(tauri::generate_context!())
        .expect("West Client başlatılamadı");
}

/// "West Launcher" adıyla kurulmuş eski sürümü (yeni ad = yeni kurulum klasörü)
/// sessizce kaldırır. Kullanıcı verileri ayrı klasörde (`WestLauncher`) olduğu için korunur.
#[cfg(windows)]
pub fn remove_old_install() {
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(15));
        let Some(local) = std::env::var_os("LOCALAPPDATA") else { return };
        let old = std::path::Path::new(&local).join("West Launcher");
        let un = old.join("uninstall.exe");
        let me = std::env::current_exe().ok();
        if !un.exists() || me.map(|m| m.starts_with(&old)).unwrap_or(true) {
            return;
        }
        tracing::info!("eski West Launcher kurulumu kaldırılıyor: {}", old.display());
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new(&un).arg("/S").creation_flags(0x0800_0000).spawn();
    });
}

#[cfg(not(windows))]
pub fn remove_old_install() {}
