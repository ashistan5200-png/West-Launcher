use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{}", io_text(.0))]
    Io(#[from] std::io::Error),
    #[error("{}", crate::i18n::tf("Ağ hatası: {0}", &[.0]))]
    Http(#[from] reqwest::Error),
    #[error("{}", crate::i18n::tf("JSON hatası: {0}", &[.0]))]
    Json(#[from] serde_json::Error),
    #[error("{}", crate::i18n::tf("Arşiv hatası: {0}", &[.0]))]
    Zip(#[from] zip::result::ZipError),
    #[error("{}", crate::i18n::tf("Dosya doğrulanamadı ({0}): beklenen {1}, bulunan {2}", &[path, expected, actual]))]
    Hash { path: String, expected: String, actual: String },
    #[error("{}", crate::i18n::tf("Bulunamadı: {0}", &[.0]))]
    NotFound(String),
    #[error("{0}")]
    Msg(String),
}

/// Dosya hatalarını anlaşılır anlat. Windows'ta "Erişim engellendi" (os error 5) çoğunlukla dosyanın başka bir
/// program tarafından kullanıldığı anlamına gelir: henüz tam kapanmamış oyun ya da dosyayı tarayan antivirüs.
fn io_text(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => crate::i18n::tf(
            "Bir dosyaya erişilemedi; başka bir program kullanıyor olabilir (hâlâ kapanmakta olan oyun ya da antivirüs). Birkaç saniye bekleyip tekrar dene. ({0})",
            &[&e],
        ),
        std::io::ErrorKind::StorageFull => crate::i18n::tf("Diskte yer kalmadı. Biraz yer açıp tekrar dene. ({0})", &[&e]),
        _ => crate::i18n::tf("Dosya hatası: {0}", &[&e]),
    }
}

impl AppError {
    /// Dosya hatasına hangi dosyada olduğunu ekle
    pub fn at(path: &std::path::Path, e: std::io::Error) -> Self {
        let kind = e.kind();
        AppError::Io(std::io::Error::new(kind, format!("{}: {e}", path.display())))
    }

    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

/// Tauri komutlarından frontend'e düz metin olarak döner.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
