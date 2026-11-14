use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("I/O hatası: {0}")]
    Io(#[from] std::io::Error),
    #[error("Ağ hatası: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON hatası: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Arşiv hatası: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Dosya doğrulanamadı ({path}): beklenen {expected}, bulunan {actual}")]
    Hash { path: String, expected: String, actual: String },
    #[error("Bulunamadı: {0}")]
    NotFound(String),
    #[error("{0}")]
    Msg(String),
}

impl AppError {
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
