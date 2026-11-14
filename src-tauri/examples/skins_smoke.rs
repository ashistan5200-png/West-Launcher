use west_lib::{core::http::Http, skins::*};
#[tokio::main]
async fn main() {
    let root = std::env::temp_dir().join(format!("west-skins-{}", std::process::id()));
    let http = Http::new();
    let lib = Library::new(&root);
    let (png, slim) = fetch_player_skin(&http, "AshiWest").await.unwrap();
    let e = lib.add(&png, "AshiWest", slim, "player:AshiWest").unwrap();
    println!("AshiWest: {} bytes slim={} id={}", png.len(), slim, e.id);
    match fetch_player_skin(&http, "zz_bu_oyuncu_yok_123").await { Err(err) => println!("missing player → {err}"), Ok(_) => println!("unexpected") }
    println!("library: {:?}", lib.list().iter().map(|e| (&e.name, e.slim)).collect::<Vec<_>>());
    let _ = std::fs::remove_dir_all(root);
}
