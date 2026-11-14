use west_lib::{content::{self, install::*, modpack, Kind, SearchQuery, Source}, core::{http::Http, noop_progress}, paths::Paths, instance::*};
#[tokio::main]
async fn main() {
    let root = std::env::temp_dir().join(format!("west-content-{}", std::process::id()));
    let paths = Paths::new(root.clone()); paths.ensure().unwrap();
    let http = Http::new();
    let q = SearchQuery { query: "roughly enough items".into(), kind: Some(Kind::Mod), game_version: Some("1.21.1".into()), loader: Some("fabric".into()), limit: Some(5), ..Default::default() };
    let r = content::search(&http, None, &q).await.unwrap();
    println!("search: total={} notices={:?}", r.total, r.notices);
    for h in r.hits.iter().take(3) { println!("  {} [{}] {} dl", h.title, h.id, h.downloads); }
    let mgr = InstanceManager::new(&paths);
    let inst = mgr.create(NewInstance{ name:"T".into(), mc_version:"1.21.1".into(), loader: Loader{kind: LoaderKind::Fabric, version: None}, icon:None, group:None }).unwrap();
    let ctx = InstallCtx { http:&http, cf_key:None, instance_id:&inst.id, instance_dir: paths.instance_dir(&inst.id), game_dir: paths.instance_game_dir(&inst.id), mc_version:"1.21.1".into(), loader:Some("fabric".into()), progress: noop_progress() };
    let rei = r.hits.iter().find(|h| h.slug == "rei").expect("REI");
    let rep = install(&ctx, Source::Modrinth, &rei.id, Kind::Mod).await.unwrap();
    println!("install REI: {:?}", rep.installed.iter().map(|i| format!("{} <- {:?}", i.file, i.dependency_of)).collect::<Vec<_>>());
    let again = install(&ctx, Source::Modrinth, &rei.id, Kind::Mod).await.unwrap();
    println!("reinstall: skipped={:?} installed={}", again.skipped, again.installed.len());
    let sh = content::search(&http, None, &SearchQuery{ query:"complementary".into(), kind:Some(Kind::Shader), game_version:Some("1.21.1".into()), limit:Some(3), ..Default::default()}).await.unwrap();
    let rep = install(&ctx, Source::Modrinth, &sh.hits[0].id, Kind::Shader).await.unwrap();
    println!("shader: {:?}", rep.installed.iter().map(|i| &i.file).collect::<Vec<_>>());
    for d in ["mods","shaderpacks"] { println!("{d}: {:?}", std::fs::read_dir(paths.instance_game_dir(&inst.id).join(d)).unwrap().map(|e| e.unwrap().file_name()).collect::<Vec<_>>()); }
    let pk = content::search(&http, None, &SearchQuery{ query:"fabulously optimized".into(), kind:Some(Kind::Modpack), limit:Some(3), ..Default::default()}).await.unwrap();
    let pctx = modpack::PackCtx { http:&http, paths:&paths, cf_key:None, concurrency:16, progress: noop_progress() };
    let p = modpack::install(&pctx, Source::Modrinth, &pk.hits[0].id).await.unwrap();
    let mods = std::fs::read_dir(paths.instance_game_dir(&p.id).join("mods")).map(|d| d.count()).unwrap_or(0);
    let cfg = paths.instance_game_dir(&p.id).join("config").exists();
    println!("modpack: {} — MC {} {:?} {:?} — {} mod, config/: {}", p.name, p.mc_version, p.loader.kind, p.loader.version, mods, cfg);
    let _ = std::fs::remove_dir_all(root);
}
