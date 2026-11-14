use tauri::WebviewWindow;

/// Native pencere arka plan efekti. Desteklenmeyen platformlarda sessizce
/// CSS bulanıklığına düşer (frontend `--blur` değişkeni).
pub fn apply_effect(window: &WebviewWindow, effect: &str) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};
        let _ = clear_mica(window);
        let _ = clear_acrylic(window);
        let _ = match effect {
            "mica" => apply_mica(window, Some(true)),
            "acrylic" => apply_acrylic(window, Some((18, 18, 22, 160))),
            _ => Ok(()),
        };
    }
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};
        let _ = clear_vibrancy(window);
        if effect != "none" {
            let _ = apply_vibrancy(window, NSVisualEffectMaterial::HudWindow, None, Some(12.0));
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (window, effect);
    }
}

#[tauri::command]
pub fn set_window_effect(window: WebviewWindow, effect: String) {
    apply_effect(&window, &effect);
}
