use west_lib::{paths::Paths, screenshots::*, instance::*};
fn main() {
    let root = std::env::temp_dir().join(format!("west-shots-{}", std::process::id()));
    let paths = Paths::new(root.clone()); paths.ensure().unwrap();
    let inst = InstanceManager::new(&paths).create(NewInstance{ name:"Galeri".into(), mc_version:"1.21.1".into(), loader: Loader{kind: LoaderKind::Vanilla, version:None}, icon:None, group:None }).unwrap();
    let dir = paths.instance_game_dir(&inst.id).join("screenshots");
    let img = image::RgbImage::from_fn(1920, 1080, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 128]));
    for i in 0..5 { img.save(dir.join(format!("2026-11-14_12.0{i}.00.png"))).unwrap(); }
    let list = list(&paths, None).unwrap();
    let t = std::time::Instant::now();
    for s in &list { make_thumb(&paths, std::path::Path::new(&s.path)).unwrap(); }
    let per = t.elapsed().as_millis() / list.len() as u128;
    let after = west_lib::screenshots::list(&paths, None).unwrap();
    let thumb = after[0].thumb.clone().unwrap();
    let (w, h) = image::image_dimensions(&thumb).unwrap();
    println!("{} görüntü, küçük resim başına {per} ms (debug), boyut {w}x{h}, {} KB", after.len(), std::fs::metadata(&thumb).unwrap().len() / 1024);
    println!("guard dışarı: {:?}", guard(&paths, "/etc/hostname").is_err());
    let _ = std::fs::remove_dir_all(root);
}
