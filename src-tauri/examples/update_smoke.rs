use west_lib::{core::http::Http, updater};
#[tokio::main]
async fn main() {
    let http = Http::new();
    println!("güncel sürümle: {:?}", updater::check(&http).await.unwrap().map(|i| i.version));
    let info = updater::check_against(&http, "0.1.0").await.unwrap().expect("0.1.0'dan yeni sürüm olmalı");
    println!("bulundu: {} → {} | {} ({} KB) | sha256: {}", info.current, info.version, info.asset_name, info.size / 1024, info.sha256.as_deref().map(|s| &s[..12]).unwrap_or("YOK"));
    println!("notlar: {:?}", info.notes.chars().take(80).collect::<String>());
    let dir = std::env::temp_dir().join("west-update-test");
    match updater::download(&http, &dir, &info, |_, _| {}).await {
        Ok(f) => println!("indirildi ve doğrulandı: {} ({} KB)", f.display(), std::fs::metadata(&f).unwrap().len() / 1024),
        Err(e) => println!("indirme: {e}"),
    }
}
