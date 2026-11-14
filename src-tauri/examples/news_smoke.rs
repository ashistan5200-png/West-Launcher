use west_lib::{core::http::Http, news, paths::Paths};
#[tokio::main]
async fn main() {
    let root = std::env::temp_dir().join("west-news-test");
    let paths = Paths::new(root); paths.ensure().unwrap();
    let http = Http::new();
    let notes = news::patch_notes(&http, &paths, 5).await.unwrap();
    for n in notes.iter().take(3) { println!("NOT: {} [{}] {}", n.title, n.kind, &n.date[..10]); }
    let body = news::patch_note_body(&http, &notes[0].content_path).await.unwrap();
    println!("gövde: {} karakter", body.len());
    let mods = news::mod_updates(&http, 40).await.unwrap();
    for m in mods.iter().take(4) { println!("MOD: {} {} ({}) {:?}", m.title, m.version_number, &m.date[..10], m.game_versions); }
    let t = std::time::Instant::now();
    let d = news::diff_assets(&http, &paths, "1.21.4", None).await.unwrap();
    println!("FARK {} ← {}: {} doku, {} ses ({:?})", d.version, d.base, d.textures.len(), d.sounds.len(), t.elapsed());
    for x in d.textures.iter().filter(|x| x.category=="block").take(6) { println!("  doku {}/{}", x.category, x.name); }
    for s in d.sounds.iter().take(4) { println!("  ses {}/{}", s.group, s.name); }
    let png = news::read_texture(&paths, "1.21.4", &d.textures[0].path).unwrap();
    let ogg = news::read_sound(&http, &paths, &d.sounds[0].hash).await.unwrap();
    println!("png {} bayt (imza ok: {}), ogg {} bayt (imza ok: {})", png.len(), &png[1..4]==b"PNG", ogg.len(), &ogg[..4]==b"OggS");
}
