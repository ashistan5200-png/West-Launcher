//! Discord Rich Presence. Ayrı, uyuyan bir iş parçacığında çalışır; yalnızca
//! durum değişince (launcher açık / oyun başladı / bitti) Discord'a yazar.
//! Discord kapalıysa veya uygulama kimliği yoksa sessizce hiçbir şey yapmaz.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

#[derive(Debug, Clone)]
pub enum Presence {
    Idle,
    Playing { instance: String, detail: String, started_unix: i64 },
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

fn worker(rx: Receiver<Presence>, mut client_id: Option<String>, mut enabled: bool) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut current = Presence::Idle;
    let mut dirty = true;
    loop {
        // Discord sonradan açılırsa yakalamak için 30 sn'de bir yeniden dener; yoksa uyur
        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Presence::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                if let Some(mut c) = client.take() {
                    let _ = c.close();
                }
                return;
            }
            Ok(Presence::Configure { client_id: id, enabled: on }) => {
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
            Ok(p) => {
                current = p;
                dirty = true;
            }
            Err(RecvTimeoutError::Timeout) => {
                if client.is_some() {
                    continue;
                }
            }
        }
        let Some(id) = client_id.clone().filter(|_| enabled) else { continue };
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
        let assets = activity::Assets::new().large_image("west").large_text("West Launcher");
        let res = match &current {
            Presence::Playing { instance, detail, started_unix } => c.set_activity(
                activity::Activity::new()
                    .details(instance)
                    .state(detail)
                    .timestamps(activity::Timestamps::new().start(*started_unix))
                    .assets(assets),
            ),
            _ => c.set_activity(activity::Activity::new().details("Launcher'da").state("Rotasını belirliyor").assets(assets)),
        };
        if res.is_err() {
            client = None; // bağlantı koptu → sonraki turda yeniden bağlan
        } else {
            dirty = false;
        }
    }
}
