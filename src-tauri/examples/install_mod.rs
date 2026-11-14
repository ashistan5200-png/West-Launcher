use west_lib::{content::{install::*, Kind, Source}, core::{http::Http, noop_progress}, instance::InstanceManager, paths::Paths};
#[tokio::main]
async fn main() {
    let root = std::path::PathBuf::from(std::env::args().nth(1).unwrap());
    let slug = std::env::args().nth(2).unwrap();
    let paths = Paths::new(root);
    let inst = InstanceManager::new(&paths).list().unwrap().remove(0);
    let ctx = InstallCtx { http: &Http::new(), cf_key: None, instance_id: &inst.id, instance_dir: paths.instance_dir(&inst.id), game_dir: paths.instance_game_dir(&inst.id), mc_version: inst.mc_version.clone(), loader: Some("fabric".into()), progress: noop_progress() };
    let r = install(&ctx, Source::Modrinth, &slug, Kind::Mod).await.unwrap();
    println!("{:?}", r.installed.iter().map(|i| format!("{} <- {:?}", i.file, i.dependency_of)).collect::<Vec<_>>());
}
