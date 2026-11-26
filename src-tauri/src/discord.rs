//! Discord Rich Presence. Ayrı, uyuyan bir iş parçacığında çalışır; yalnızca
//! durum değişince (launcher'da sayfa değişti / oyun başladı / bitti) Discord'a yazar.
//! Discord kapalıysa veya uygulama kimliği yoksa sessizce hiçbir şey yapmaz.
//!
//! Görseller westclient.app'ten gelir (Discord adresli görselleri kendisi önbelleğe alır),
//! bu yüzden Developer Portal'a resim yüklemek gerekmez.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

/// West Client'ın Discord Developer Portal'daki uygulama kimliği (gizli değil).
pub const DEFAULT_APP_ID: &str = "1571515539149422734";

const SITE: &str = "https://westclient.app";
const LOGO: &str = "https://westclient.app/assets/rpc/west.png";

/// Oyunun Discord'da gösterilen özeti
#[derive(Debug, Clone, PartialEq)]
pub struct GameInfo {
    /// Fabric, Quilt, Forge, NeoForge, Vanilla
    pub loader: String,
    pub mc: String,
    pub mods: usize,
}

#[derive(Debug, Clone)]
pub enum Presence {
    /// Launcher açık; `page` hangi sayfada olunduğu (home, library, browse…)
    Idle { page: String },
    Playing { instance: String, game: GameInfo, server: Option<String>, started_unix: i64 },
    /// Yeni uygulama kimliği / açma-kapama
    Configure { client_id: Option<String>, enabled: bool },
    Shutdown,
}

pub struct Discord {
    tx: Sender<Presence>,
}

impl Discord {
    pub fn start(client_id: Option<String>, enabled: bool) -> Self {
        let (tx, rx) = channel();
        std::thread::Builder::new()
            .name("discord-rpc".into())
            .spawn(move || worker(rx, client_id, enabled))
            .expect("discord thread");
        Self { tx }
    }

    pub fn send(&self, p: Presence) {
        let _ = self.tx.send(p);
    }
}

/// Launcher sayfasına göre "ne yapıyor" yazısı
fn page_text(page: &str) -> &'static str {
    match page {
        "library" => "Kütüphanesini düzenliyor",
        "browse" | "discover" => "Yeni modlar keşfediyor",
        "instance" => "Paketini hazırlıyor",
        "skins" | "account" => "Skinine bakıyor",
        "gallery" => "Ekran görüntülerine bakıyor",
        "news" => "Minecraft haberlerini okuyor",
        "settings" => "Ayarları kurcalıyor",
        "servers" => "Sunucu seçiyor",
        _ => "Ana sayfada",
    }
}

/// Yükleyici rozeti (küçük görsel) ve ad
fn loader_badge(loader: &str) -> (&'static str, &'static str) {
    match loader.to_ascii_lowercase().as_str() {
        "fabric" => ("https://westclient.app/assets/rpc/fabric.png", "Fabric"),
        "quilt" => ("https://westclient.app/assets/rpc/quilt.png", "Quilt"),
        "forge" => ("https://westclient.app/assets/rpc/forge.png", "Forge"),
        "neoforge" => ("https://westclient.app/assets/rpc/neoforge.png", "NeoForge"),
        _ => ("https://westclient.app/assets/rpc/vanilla.png", "Vanilla"),
    }
}

/// Oyundayken alt satır: sunucu, yoksa yükleyici ve mod sayısı
fn playing_state(game: &GameInfo, server: Option<&str>) -> String {
    use crate::i18n::t;
    if let Some(s) = server.filter(|s| !s.trim().is_empty()) {
        // Port yazılmaz: "play.ornek.com:25565" → "play.ornek.com"
        let host = s.rsplit_once(':').filter(|(_, p)| p.chars().all(|c| c.is_ascii_digit())).map(|(h, _)| h).unwrap_or(s);
        return t("{0} sunucusunda").replace("{0}", host);
    }
    let (_, name) = loader_badge(&game.loader);
    if game.mods > 0 && name != "Vanilla" {
        t("{0} {1} · {2} mod").replace("{0}", name).replace("{1}", &game.mc).replace("{2}", &game.mods.to_string())
    } else {
        t("{0} {1} · tek başına").replace("{0}", name).replace("{1}", &game.mc)
    }
}

fn worker(rx: Receiver<Presence>, mut client_id: Option<String>, mut enabled: bool) {
    use crate::i18n::t;
    let mut client: Option<DiscordIpcClient> = None;
    let mut current = Presence::Idle { page: "home".into() };
    let mut dirty = true;
    // Launcher'da geçen süre, açıldığı andan sayılır
    let opened = chrono::Utc::now().timestamp();
    loop {
        // Discord sonradan açılırsa yakalamak için 30 sn'de bir yeniden dener; yoksa uyur
        let first = rx.recv_timeout(Duration::from_secs(30));
        let mut batch = vec![];
        match first {
            Ok(p) => batch.push(p),
            Err(RecvTimeoutError::Disconnected) => batch.push(Presence::Shutdown),
            Err(RecvTimeoutError::Timeout) => {
                if client.is_some() && !dirty {
                    continue;
                }
            }
        }
        // Discord dakikada birkaç güncelleme kabul eder: art arda gelen sayfa geçişlerini birleştir
        if matches!(batch.first(), Some(Presence::Idle { .. })) {
            while let Ok(p) = rx.recv_timeout(Duration::from_millis(1500)) {
                batch.push(p);
            }
        }
        for p in batch {
            match p {
                Presence::Shutdown => {
                    if let Some(mut c) = client.take() {
                        let _ = c.close();
                    }
                    return;
                }
                Presence::Configure { client_id: id, enabled: on } => {
                    if id != client_id || on != enabled {
                        if let Some(mut c) = client.take() {
                            let _ = c.clear_activity();
                            let _ = c.close();
                        }
                        client_id = id;
                        enabled = on;
                        dirty = true;
                    }
                }
                // Oyun sürerken launcher'da sayfa değişmesi oyundaki durumu ezmez
                Presence::Idle { page } => {
                    match &mut current {
                        Presence::Playing { .. } if page != "__exit" => {}
                        Presence::Idle { page: cur } if *cur == page => {}
                        _ => {
                            let page = if page == "__exit" { "home".to_string() } else { page };
                            current = Presence::Idle { page };
                            dirty = true;
                        }
                    }
                }
                p @ Presence::Playing { .. } => {
                    current = p;
                    dirty = true;
                }
            }
        }
        if !enabled {
            continue;
        }
        // Kullanıcı kendi uygulama kimliğini girmediyse West Client'ın resmi Discord uygulaması
        let id = client_id.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| DEFAULT_APP_ID.to_string());
        if client.is_none() {
            let Ok(mut c) = DiscordIpcClient::new(&id) else { continue };
            if c.connect().is_err() {
                continue; // Discord açık değil
            }
            client = Some(c);
            dirty = true;
        }
        if !dirty {
            continue;
        }
        let c = client.as_mut().unwrap();
        let download = t("West Client'ı indir");
        let buttons = vec![activity::Button::new(&download, SITE)];
        let res = match &current {
            Presence::Playing { instance, game, server, started_unix } => {
                let (badge, name) = loader_badge(&game.loader);
                let small = format!("{name} · {}", game.mc);
                let state = playing_state(game, server.as_deref());
                let large = t("West Client ile oynuyor");
                c.set_activity(
                    activity::Activity::new()
                        .details(instance)
                        .state(&state)
                        .timestamps(activity::Timestamps::new().start(*started_unix))
                        .assets(activity::Assets::new().large_image(LOGO).large_text(&large).small_image(badge).small_text(&small))
                        .buttons(buttons),
                )
            }
            Presence::Idle { page } => {
                let details = t(page_text(page));
                let state = t("Launcher'da, oyuna hazırlanıyor");
                c.set_activity(
                    activity::Activity::new()
                        .details(&details)
                        .state(&state)
                        .timestamps(activity::Timestamps::new().start(opened))
                        .assets(activity::Assets::new().large_image(LOGO).large_text("West Client"))
                        .buttons(buttons),
                )
            }
            _ => Ok(()),
        };
        if res.is_err() {
            client = None; // bağlantı koptu → sonraki turda yeniden bağlan
        } else {
            dirty = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_lines() {
        let g = GameInfo { loader: "Fabric".into(), mc: "1.21.11".into(), mods: 42 };
        assert_eq!(playing_state(&g, None), "Fabric 1.21.11 · 42 mod");
        assert_eq!(playing_state(&g, Some("play.ornek.com:25565")), "play.ornek.com sunucusunda");
        let v = GameInfo { loader: "Vanilla".into(), mc: "1.21.11".into(), mods: 0 };
        assert_eq!(playing_state(&v, None), "Vanilla 1.21.11 · tek başına");
        assert_eq!(loader_badge("NeoForge").1, "NeoForge");
        assert_eq!(page_text("browse"), "Yeni modlar keşfediyor");
    }
}
