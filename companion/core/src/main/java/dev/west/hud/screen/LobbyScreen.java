package dev.west.hud.screen;

import dev.west.hud.Config;
import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.lobby.LobbyBiome;
import dev.west.hud.lobby.LobbyClient;
import dev.west.hud.lobby.LobbyFrame;
import dev.west.hud.lobby.LobbyScene;
import dev.west.hud.lobby.SceneGen;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

/**
 * Ana menü yerine 3B lobi: seçilen biyomun içinde, ortada oyuncunun kendi karakteri; lobiye
 * katılan arkadaşlar lider ortada olacak şekilde yay biçiminde dizilir. Solda lobi paneli,
 * sol altta bilgi paneli, altta biyom seçici, sağ altta Oyna kartı; Esc (ya da seçilen tuş) ile
 * modül menüsü.
 */
public final class LobbyScreen extends WestShell {
    private enum Modal { NONE, PLAY, MODULES, DELETE }

    private static final String[] INFO_KEYS = { "fps", "version", "loader", "ping", "clock", "profile" };
    private static final String[] INFO_NAMES = { "FPS", "Sürüm", "Yükleyici", "Ping", "Saat", "Profil" };
    private static final String[] KEYS = { "esc", "rshift", "m", "tab" };
    private static final String[] KEY_NAMES = { "Esc", "Sağ Shift", "M", "Tab" };
    private static final int[] KEY_CODES = { 256, 344, 77, 258 };
    private static final String[] MODES = { "Hayatta kalma", "Yaratıcı", "Macera", "İzleyici" };

    private final LobbyFrame frame = new LobbyFrame();
    private final LobbyClient client = LobbyClient.INSTANCE;
    private LobbyBiome biome;
    private final List<float[]> particles = new ArrayList<>();
    /** Işınlanma parçacıkları: x y z vx vy vz yaşam */
    private final List<float[]> bursts = new ArrayList<>();
    private final Random rnd = new Random();
    private final Map<String, LobbyFrame.Avatar> avatarByKey = new HashMap<>();
    private boolean membersSeen, hoveringList;
    private int infoRight, pickerTop = 9999;
    private Modal modal = Modal.NONE;
    private int playTab;
    private float playScroll, friendScroll, moduleScroll;
    private String toast;
    private long toastAt;
    private String expanded;
    private List<Game.ServerInfo> servers;
    private int serverTries;

    public LobbyScreen() {
        biome = LobbyBiome.of(WestHud.config.data.lobbyBiome);
        client.refreshNow();
    }

    // Arka plan saati (lobi başka bir West sayfasının arkasında da çizilir)
    private long bgLast = System.nanoTime();
    private float bgTime, bdt;
    /** Gardırop: kamera karaktere yaklaşır, sağda aksesuarlar */
    private boolean wardrobe;
    private float zoom, wardrobeYaw, wardrobeSpin = 1;
    private WardrobeScreen wardrobePanel;
    private boolean draggingModel;
    private double dragLastX;
    private final java.util.Set<String> dismissedWorldInvites = new java.util.HashSet<>();

    /** Gökyüzü, 3B sahne ve parçacıklar (başka sayfalar da arka plan olarak kullanır) */
    void backdrop(Gfx g) {
        long now = System.nanoTime();
        bdt = Math.min(0.1f, (now - bgLast) / 1e9f);
        bgLast = now;
        bgTime += bdt;
        Config.Data d = WestHud.config.data;
        int sw = g.width(), sh = g.height();
        dev.west.hud.social.SocialClient.INSTANCE.poll(null);
        events();
        // Lobideyken biyomu lider belirler
        if (client.ready() && client.biome != null) {
            LobbyBiome b = LobbyBiome.of(client.biome);
            if (b != biome) {
                biome = b;
                particles.clear();
            }
        }
        syncAvatars(bdt);
        zoom += ((wardrobe ? 1 : 0) - zoom) * Math.min(1, bdt * 5f);
        if (Math.abs(zoom - (wardrobe ? 1 : 0)) < 0.002f) zoom = wardrobe ? 1 : 0;
        frame.scene = SceneGen.cached(biome);
        frame.time = bgTime;
        frame.light = d.lobbyLight;
        LobbyFrame.Avatar self = selfAvatar();
        frame.camera.update(bgTime, d.lobbyCinematic, frame.avatars.size(), sw, sh);
        if (self != null && zoom > 0) frame.camera.focus(self.x, self.y, self.z, ease(zoom), sw, sh);
        sky(g, sw, sh, bgTime);
        boolean ready = g.lobby(frame);
        if (!ready && !d.lobbyLight) {
            String s = Tr.t("Lobi hazırlanıyor…");
            g.text(s, (sw - g.textWidth(s)) / 2, sh / 3, 0xAAFFFFFF, false);
        }
        particles(g, sw, sh);
        bursts(g);
    }

    private LobbyFrame.Avatar selfAvatar() {
        for (LobbyFrame.Avatar a : frame.avatars) if (a.self) return a;
        return null;
    }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        beginFrame(g, mx, my);
        Game game = WestHud.game;
        int sw = g.width(), sh = g.height();
        if (servers == null || ++serverTries % 240 == 0) servers = game.servers(64);
        backdrop(g);
        if (zoom > 0.02f || wardrobe) {
            wardrobeUi(g, mx, my, sw, sh);
            ui.end();
            return;
        }
        ui.suspended = modal != Modal.NONE;
        hoveringList = false;
        tags(g);
        topBar(g, sw);
        infoPanel(g, sh);
        int cardX = playCard(g, sw, sh);
        dock(g, sw, sh);
        biomePicker(g, sw, sh, cardX);
        leftPanel(g, sw, sh);
        int by = inviteBanner(g, sw);
        worldInviteBanner(g, sw, by);
        toastLine(g, sw);
        ui.suspended = false;
        if (modal != Modal.NONE) {
            g.nextLayer();
            g.fill(0, 0, sw, sh, 0x80000000);
            switch (modal) {
                case PLAY -> playWindow(g, sw, sh);
                case MODULES -> modulesWindow(g, sw, sh);
                case DELETE -> deleteWindow(g, sw, sh);
                default -> {}
            }
        }
        ui.end();
    }

    // ───────── Sağ: bölümler ─────────

    private void dock(Gfx g, int sw, int sh) {
        Theme t = ui.t;
        int w = 104, h = 19, gap = 3;
        int x = sw - w - 10, y = 34;
        var soc = dev.west.hud.social.SocialClient.INSTANCE;
        int pending = soc.requests.size() + soc.invites.size();
        Object[][] items = {
                { "worlds", Icon.WORLD, Tr.t("Dünyalar") }, { "servers", Icon.SERVER, Tr.t("Sunucular") }, { "share", Icon.SHARE, Tr.t("Dünyayı paylaş") },
                { "stats", Icon.STATS, Tr.t("İstatistikler") }, { "social", Icon.CHAT, Tr.t("Sosyal") }, { "wardrobe", Icon.GEM, Tr.t("Gardırop") } };
        for (Object[] it : items) {
            String id = (String) it[0];
            boolean hv = ui.hover(x, y, w, h);
            float hh = hov("dock" + id, hv);
            Ui.round(g, x, y, w, h, 7, Theme.mix(0xC40E1016, 0xE01A1D27, hh));
            Ui.outline(g, x, y, w, h, 7, hv ? Theme.alpha(t.accent, 0xCC) : 0x22FFFFFF);
            Icons.draw(g, (Icon) it[1], x + 7, y + 5, 9, hv ? t.accent | 0xFF000000 : 0xDDFFFFFF);
            g.text(ui.fit((String) it[2], w - 30), x + 22, y + 6, 0xFFFFFFFF, false);
            if (id.equals("social") && pending > 0) {
                String n = String.valueOf(pending);
                int bw = Math.max(10, small(g, n) + 6);
                Ui.round(g, x + w - bw - 5, y + 4, bw, 11, 5, t.accent | 0xFF000000);
                smallText(g, n, x + w - bw - 5 + (bw - small(g, n)) / 2, y + 6, t.onAccent);
            }
            if (ui.clicked(x, y, w, h)) {
                WestHud.game.click();
                switch (id) {
                    case "worlds" -> go(new HomeScreen(this, HomeScreen.Page.WORLDS));
                    case "servers" -> go(new HomeScreen(this, HomeScreen.Page.SERVERS));
                    case "share" -> {
                        say(Tr.t("Paylaşmak istediğin dünyayı aç; oyunda Esc → Dünyayı paylaş"));
                        go(new HomeScreen(this, HomeScreen.Page.WORLDS));
                    }
                    case "stats" -> go(new HomeScreen(this, HomeScreen.Page.STATS));
                    case "social" -> go(new HomeScreen(this, HomeScreen.Page.SOCIAL));
                    default -> openWardrobe();
                }
            }
            y += h + gap;
        }
    }

    // ───────── Gardırop (yakınlaşma) ─────────

    private void openWardrobe() {
        wardrobe = true;
        wardrobeYaw = 0;
        wardrobeSpin = 1;
        modal = Modal.NONE;
        if (wardrobePanel == null) wardrobePanel = new WardrobeScreen(this, true);
    }

    private void closeWardrobe() {
        wardrobe = false;
        draggingModel = false;
    }

    private void wardrobeUi(Gfx g, int mx, int my, int sw, int sh) {
        Theme t = ui.t;
        float in = ease(zoom);
        // Karakteri kendi etrafında döndür (sürükleyince elle)
        if (wardrobe && !draggingModel) wardrobeYaw += wardrobeSpin * bdt * 22f;
        // Sol üst: geri + başlık, sağ üst: coin
        if (iconButton("wd-back", Icon.BACK, 10, 8, 20, Tr.t("Geri"), 0)) closeWardrobe();
        bigText(g, Tr.t("Gardırop"), 36, 12, Theme.alpha(0xFFFFFFFF, (int) (255 * in)), 1.25f);
        String coins = Tr.t("{0} West Coin", WestHud.config.data.coins);
        int cw = small(g, coins) + 24;
        Ui.round(g, sw - cw - 10, 10, cw, 16, 8, 0xC40E1016);
        Ui.round(g, sw - cw - 5, 14, 8, 8, 4, 0xFFF2B654);
        smallText(g, coins, sw - cw + 7, 14, 0xFFF6D38F);
        // Sol: karakter alanı ipucu
        String hint = Tr.t("Sürükleyerek döndür");
        smallText(g, hint, (int) (sw * 0.28f) - small(g, hint) / 2, sh - 16, 0x99FFFFFF);
        // Sağ: aksesuarlar (sağdan kayarak gelir)
        int pw = Math.max(200, Math.min(sw / 2 - 10, 300));
        int px = sw - pw - 10 + Math.round((1 - in) * (pw + 20));
        int top = 34, bottom = sh - 10;
        Ui.round(g, px - 6, top - 6, pw + 12, bottom - top + 12, 12, 0xD00E1016);
        Ui.outline(g, px - 6, top - 6, pw + 12, bottom - top + 12, 12, 0x22FFFFFF);
        if (wardrobePanel != null) wardrobePanel.panel(g, ui, px, top, pw, bottom);
        if (!wardrobe && zoom < 0.03f) zoom = 0;
    }

    // ───────── Olaylar (ışınlanma, davet, bildirim) ─────────

    private void events() {
        LobbyClient.Event e;
        while ((e = client.events.poll()) != null) {
            switch (e.kind()) {
                case "toast" -> say(e.text());
                case "moved" -> {
                    // Başka bir lobiye geçtin: herkes ışınlanarak belirir
                    for (LobbyFrame.Avatar a : frame.avatars) a.alpha = 0;
                    teleportSound();
                }
                default -> {}
            }
        }
        if (client.error != null && System.currentTimeMillis() - client.errorAt < 5000) {
            say(client.error);
            client.error = null;
        }
    }

    private void say(String s) {
        toast = s;
        toastAt = System.currentTimeMillis();
    }

    private void teleportSound() {
        if (WestHud.config.data.lobbySound) WestHud.game.playSound("minecraft:entity.player.teleport", 0.8f, 1f);
    }

    // ───────── Karakterler ─────────

    private void syncAvatars(float dt) {
        List<String[]> want = new ArrayList<>();
        Game game = WestHud.game;
        if (client.ready() && !client.members.isEmpty()) {
            List<LobbyClient.Person> ms = new ArrayList<>(client.members);
            ms.sort((a, b) -> Boolean.compare(b.leader(), a.leader()));
            for (LobbyClient.Person p : ms) {
                boolean self = p.id().equals(client.myId);
                want.add(new String[] { p.id(), self ? game.playerName() : p.display(), p.mcUuid() == null ? null : p.mcUuid().toString(), self ? "1" : "0" });
            }
        } else {
            want.add(new String[] { "self", game.playerName(), null, "1" });
        }
        String test = System.getenv("WEST_LOBBY_TEST");
        if (test != null && !client.ready()) for (String n : test.split(",")) if (!n.isBlank()) want.add(new String[] { "test:" + n.trim(), n.trim(), null, "0" });

        List<LobbyFrame.Avatar> next = new ArrayList<>();
        for (String[] w : want) {
            LobbyFrame.Avatar a = avatarByKey.get(w[0]);
            if (a == null && "1".equals(w[3])) {
                // Kendi karakterin anahtar değiştirdiyse (çevrimdışı → lobi) yeniden ışınlanmasın
                for (LobbyFrame.Avatar o : frame.avatars) if (o.self) a = o;
                if (a != null) {
                    avatarByKey.remove(a.key);
                    LobbyFrame.Avatar n = new LobbyFrame.Avatar(w[0]);
                    n.alpha = a.alpha;
                    a = n;
                }
            }
            if (a == null) {
                a = new LobbyFrame.Avatar(w[0]);
                if (membersSeen) {
                    a.alpha = 0;
                    teleportSound();
                }
            }
            a.name = w[1];
            a.uuid = w[2] == null ? null : java.util.UUID.fromString(w[2]);
            a.self = "1".equals(w[3]);
            avatarByKey.put(w[0], a);
            next.add(a);
        }
        avatarByKey.keySet().removeIf(k -> next.stream().noneMatch(a -> a.key.equals(k)));
        frame.avatars.clear();
        frame.avatars.addAll(next);
        if (client.ready()) membersSeen = true;
        // Yay: lider ortada, sonra sağ-sol dönüşümlü
        for (int i = 0; i < frame.avatars.size(); i++) {
            LobbyFrame.Avatar a = frame.avatars.get(i);
            int k = (i + 1) / 2;
            int side = i % 2 == 1 ? 1 : -1;
            float ang = (float) Math.toRadians(k * 27f) * side;
            float r = 5.8f;
            a.x = (float) Math.sin(ang) * r;
            a.z = 0.6f - (1 - (float) Math.cos(ang)) * r;
            a.y = LobbyScene.GROUND + 1;
            a.yaw = -10f - (float) Math.toDegrees(ang) * 0.35f;
            if (a.self && zoom > 0) a.yaw += wardrobeYaw * zoom;
            if (a.alpha < 1) {
                if (a.alpha <= 0.001f) burst(a);
                a.alpha = Math.min(1, a.alpha + dt * 1.4f);
            }
        }
    }

    /** Ender incisi ışınlanması: mor parçacıklar karakterin çevresinden saçılır */
    private void burst(LobbyFrame.Avatar a) {
        for (int i = 0; i < 70; i++) {
            float ang = rnd.nextFloat() * 6.283f, sp = 0.4f + rnd.nextFloat() * 1.6f;
            bursts.add(new float[] { a.x + (rnd.nextFloat() - 0.5f) * 0.8f, a.y + rnd.nextFloat() * 2f, a.z + (rnd.nextFloat() - 0.5f) * 0.8f,
                    (float) Math.cos(ang) * sp, (rnd.nextFloat() - 0.3f) * 1.2f, (float) Math.sin(ang) * sp, 0.6f + rnd.nextFloat() * 0.8f });
        }
        a.alpha = 0.002f;
    }

    private void bursts(Gfx g) {
        for (int i = bursts.size() - 1; i >= 0; i--) {
            float[] p = bursts.get(i);
            p[6] -= bdt;
            if (p[6] <= 0) {
                bursts.remove(i);
                continue;
            }
            p[0] += p[3] * bdt;
            p[1] += p[4] * bdt;
            p[2] += p[5] * bdt;
            p[3] *= 0.96f;
            p[5] *= 0.96f;
            float[] s = frame.camera.project(p[0], p[1], p[2]);
            if (s == null) continue;
            int sz = Math.max(1, Math.round(14f / s[2]));
            int a = Math.round(Math.min(1, p[6] * 2) * 230);
            int col = (i % 3 == 0) ? 0xE8B5FF : (i % 3 == 1) ? 0xA35CFF : 0x6E2BD9;
            g.fill(Math.round(s[0]), Math.round(s[1]), Math.round(s[0]) + sz, Math.round(s[1]) + sz, (a << 24) | col);
        }
    }

    /** Kafa üstü etiketler: isim, liderin altında "LİDER", sunucudaysa "Sunucu · Katıl" */
    private void tags(Gfx g) {
        Theme t = ui.t;
        for (int i = 0; i < frame.avatars.size(); i++) {
            LobbyFrame.Avatar a = frame.avatars.get(i);
            if (a.alpha < 0.3f) continue;
            float[] p = frame.camera.project(a.x, a.y + 2.15f, a.z);
            if (p == null) continue;
            int cx = Math.round(p[0]), bottom = Math.round(p[1]);
            LobbyClient.Person person = person(a.key);
            boolean leader = client.ready() ? person != null && person.leader() : i == 0;
            // Sunucu satırı (adın üstünde)
            String server = null;
            boolean canJoin = false;
            if (person != null && !a.self && person.online()) {
                if (person.singleplayer()) server = Tr.t("Tek oyunculu dünyada");
                else if (person.server() != null) {
                    server = person.serverName() != null && !person.serverName().isBlank() ? person.serverName() : person.server();
                    canJoin = person.joinable();
                }
            }
            String name = a.name;
            int nw = small(g, name);
            String you = a.self ? Tr.t("Sen") : null;
            int yw = you == null ? 0 : small(g, you) + 4;
            int w = nw + yw + 10, h = 11;
            int x = cx - w / 2, y = bottom - h - (leader ? 10 : 0);
            Ui.round(g, x, y, w, h, 4, 0xD40D0F16);
            smallText(g, name, x + 5, y + 2, 0xFFFFFFFF);
            if (you != null) smallText(g, you, x + 5 + nw + 4, y + 2, 0x99FFFFFF);
            if (leader) {
                String l = Tr.t("LİDER");
                int lw = small(g, l) + 10;
                Ui.round(g, cx - lw / 2, y + h + 2, lw, 9, 4, t.accent | 0xFF000000);
                smallText(g, l, cx - lw / 2 + 5, y + h + 3, t.onAccent);
            }
            if (server != null) {
                String join = canJoin ? Tr.t("Katıl") : null;
                String label = ui.fit(server, 110);
                int lw = small(g, label) + 10 + (join == null ? 0 : small(g, join) + 12);
                int sx = cx - lw / 2, sy = y - 13;
                boolean hv = canJoin && ui.hover(sx, sy, lw, 11);
                Ui.round(g, sx, sy, lw, 11, 4, hv ? Theme.alpha(t.accent, 0xE6) : 0xB30B0D14);
                smallText(g, label, sx + 5, sy + 2, hv ? t.onAccent : 0xDDFFFFFF);
                if (join != null) {
                    int jx = sx + 5 + small(g, label) + 5;
                    smallText(g, "·", jx, sy + 2, 0x88FFFFFF);
                    smallText(g, join, jx + 7, sy + 2, hv ? t.onAccent : t.accent | 0xFF000000);
                    if (ui.clicked(sx, sy, lw, 11)) {
                        WestHud.game.click();
                        // Bağlantıyı oyunun kendi bağlanma ekranı kurar; sunucunun kuralları aynen geçerli
                        WestHud.game.connect(server, person.server());
                    }
                }
            }
        }
    }

    private LobbyClient.Person person(String key) {
        for (LobbyClient.Person p : client.members) if (p.id().equals(key)) return p;
        return null;
    }

    // ───────── Üst çubuk ─────────

    private void topBar(Gfx g, int sw) {
        Theme t = ui.t;
        int bx = 10, by = 8;
        Ui.round(g, bx, by, 18, 18, 5, t.accent | 0xFF000000);
        Icons.draw(g, Icon.LOGO, bx + 4, by + 4, 10, t.onAccent);
        brand(g, Tr.t("West Client"), bx + 24, by + 5, 0xFFFFFFFF, 0.6f);
        Config.Data d = WestHud.config.data;
        String[] labels = { d.lobbySound ? Tr.t("Ses: açık") : Tr.t("Ses: kapalı"), Tr.t("Modüller · {0}", Tr.t(KEY_NAMES[keyIndex()])), Tr.t("Ayarlar"), Tr.t("Oyundan çık") };
        int x = sw - 10;
        for (int i = labels.length - 1; i >= 0; i--) {
            int w = g.textWidth(labels[i]) + 16;
            x -= w;
            boolean hv = ui.hover(x, 8, w, 18);
            float hh = hov("top" + i, hv);
            Ui.round(g, x, 8, w, 18, 9, Theme.mix(0xD40D0F16, 0xE81A1D27, hh));
            Ui.outline(g, x, 8, w, 18, 9, i == 1 ? Theme.alpha(t.accent, 0xCC) : 0x30FFFFFF);
            g.text(labels[i], x + 8, 13, 0xFFFFFFFF, false);
            if (ui.clicked(x, 8, w, 18)) {
                WestHud.game.click();
                switch (i) {
                    case 0 -> {
                        d.lobbySound = !d.lobbySound;
                        WestHud.save();
                    }
                    case 1 -> modal = Modal.MODULES;
                    case 2 -> WestHud.game.open(Game.Target.OPTIONS);
                    case 3 -> WestHud.game.open(Game.Target.QUIT);
                    default -> {}
                }
            }
            x -= 5;
        }
        // Simgeler: bildirimler (davet ve istekler), dil, tam ekran
        var soc = dev.west.hud.social.SocialClient.INSTANCE;
        int pending = soc.requests.size() + soc.invites.size();
        Game game = WestHud.game;
        x -= 18;
        if (iconButton("fs", Icon.FULLSCREEN, x, 8, 18, game.fullscreen() ? Tr.t("Pencere") : Tr.t("Tam ekran"), 0)) game.toggleFullscreen();
        x -= 21;
        if (iconButton("lang", Icon.GLOBE, x, 8, 18, Tr.t("Dil"), 0)) game.open(Game.Target.LANGUAGE);
        x -= 21;
        if (iconButton("bell", Icon.BELL, x, 8, 18, Tr.t("Bildirimler"), 0)) go(new HomeScreen(this, HomeScreen.Page.SOCIAL));
        if (pending > 0) Ui.round(g, x + 13, 9, 5, 5, 3, t.accent | 0xFF000000);
    }

    private int keyIndex() {
        String k = WestHud.config.data.lobbyMenuKey;
        for (int i = 0; i < KEYS.length; i++) if (KEYS[i].equals(k)) return i;
        return 0;
    }

    // ───────── Sol panel: lobi ve arkadaşlar ─────────

    private void leftPanel(Gfx g, int sw, int sh) {
        Theme t = ui.t;
        int x = 10, y = 34, w = clamp(sw / 4, 140, 190);
        int pad = 8;
        List<LobbyClient.Person> members = client.ready() ? client.members : List.of();
        List<LobbyClient.Person> friends = client.ready() ? client.friends.stream().filter(f -> !f.inMyLobby()).toList() : List.of();
        int count = client.ready() ? Math.max(1, members.size()) : 1;
        boolean leader = !client.ready() || client.amLeader();
        int h = Math.max(80, Math.min(sh - y - 100, 210));
        if (pickerTop < y + h + 6) h = Math.max(60, pickerTop - 6 - y);
        if (!client.ready()) h = Math.min(h, 34 + wrap(g, statusText(), Math.round((w - 2 * pad) / 0.8f)).size() * 9 + (statusButton() != null ? 24 : 6));
        glass(g, x, y, w, h, 10);
        int cy = y + pad;
        String title = leader ? Tr.t("Lobin") : lobbyOf(client.leaderName == null ? "" : client.leaderName);
        g.textBold(ui.fit(title, w - 2 * pad - 26), x + pad, cy, 0xFFFFFFFF, false);
        String counter = count + "/7";
        g.text(counter, x + w - pad - g.textWidth(counter), cy, 0xAAFFFFFF, false);
        cy += 14;
        g.fill(x + pad, cy, x + w - pad, cy + 1, 0x22FFFFFF);
        cy += 6;
        if (!client.ready()) {
            statusMessage(g, x + pad, cy, w - 2 * pad);
            return;
        }
        // Gizlilik
        String[] pv = { "open", "friends", "private" };
        String[] pn = { Tr.t("Açık"), Tr.t("Arkadaşlar"), Tr.t("Özel") };
        int sel = 1;
        for (int i = 0; i < pv.length; i++) if (pv[i].equals(client.privacy)) sel = i;
        if (leader) {
            int segW = (w - 2 * pad) / 3;
            for (int i = 0; i < 3; i++) {
                int bx = x + pad + i * segW;
                boolean on = i == sel;
                boolean hv = ui.hover(bx, cy, segW - 2, 14);
                Ui.round(g, bx, cy, segW - 2, 14, 7, on ? t.accent | 0xFF000000 : hv ? 0x30FFFFFF : 0x18FFFFFF);
                String l = ui.fit(pn[i], Math.round((segW - 6) / 0.8f));
                smallText(g, l, bx + (segW - 2 - small(g, l)) / 2, cy + 4, on ? t.onAccent : 0xDDFFFFFF);
                if (!on && ui.clicked(bx, cy, segW - 2, 14)) {
                    WestHud.game.click();
                    client.setPrivacy(pv[i]);
                }
            }
        } else {
            smallText(g, Tr.t("Gizlilik: {0}", pn[sel]), x + pad, cy + 3, 0x99FFFFFF);
        }
        cy += 20;
        // Liste (kaydırılabilir): önce lobidekiler, sonra arkadaşlar
        int listTop = cy, listBottom = y + h - (leader ? pad : 28);
        int rowH = 22;
        String hdrLobby = Tr.t("Lobidekiler"), hdrFriends = Tr.t("Arkadaşlar");
        List<Object> rows = new ArrayList<>();
        rows.add(hdrLobby);
        rows.addAll(members);
        rows.add(hdrFriends);
        if (friends.isEmpty()) rows.add(new String[] { Tr.t("Burada West Client'ta karşılıklı takipleştiğin arkadaşların görünür.") });
        else rows.addAll(friends);
        int textW = Math.round((w - 2 * pad) / 0.8f);
        int total = 0;
        for (Object r : rows) {
            if (r instanceof String) total += 14;
            else if (r instanceof String[] s) total += wrap(g, s[0], textW).size() * 9 + 3;
            else total += rowH + (r instanceof LobbyClient.Person p && p.id().equals(expanded) ? 18 : 0);
        }
        friendScroll = Math.max(0, Math.min(Math.max(0, total - (listBottom - listTop)), friendScroll));
        g.scissor(x, listTop, x + w, listBottom);
        int ry = listTop - Math.round(friendScroll);
        for (Object r : rows) {
            if (r instanceof String s) {
                smallText(g, s.toUpperCase(Locale.ROOT), x + pad, ry + 3, 0x77FFFFFF);
                ry += 14;
            } else if (r instanceof String[] s) {
                for (String line : wrap(g, s[0], textW)) {
                    smallText(g, line, x + pad, ry + 2, 0x88FFFFFF);
                    ry += 9;
                }
                ry += 3;
            } else {
                ry = personRow(g, (LobbyClient.Person) r, x + pad - 2, ry, w - 2 * pad + 4, rowH, members.size(), leader, listTop, listBottom);
            }
        }
        g.noScissor();
        if (ui.hover(x, listTop, w, listBottom - listTop)) hoveringList = true;
        if (!leader && outlineButton("leave", Tr.t("Lobiden ayrıl"), Icon.EXIT, x + pad, y + h - 24, w - 2 * pad, 16, false)) client.leave();
    }

    /** "<isim>'in lobisi" (Türkçede ünlü uyumuyla), "<name>'s lobby", "Lobby von <Name>" */
    static String lobbyOf(String name) {
        String lang = WestHud.config.data.language;
        if ("en".equals(lang)) return name + "'s lobby";
        if ("de".equals(lang)) return "Lobby von " + name;
        return name + possessive(name) + " lobisi";
    }

    /** Türkçe iyelik eki: Ali'nin, Can'ın, Notch'un, jeb_'in */
    static String possessive(String name) {
        String low = name.toLowerCase(Locale.forLanguageTag("tr"));
        char last = 'e';
        for (int i = low.length() - 1; i >= 0; i--) {
            if ("aeıioöuü".indexOf(low.charAt(i)) >= 0) {
                last = low.charAt(i);
                break;
            }
        }
        String v = switch (last) {
            case 'a', 'ı' -> "ı";
            case 'o', 'u' -> "u";
            case 'ö', 'ü' -> "ü";
            default -> "i";
        };
        boolean endsVowel = !low.isEmpty() && "aeıioöuü".indexOf(low.charAt(low.length() - 1)) >= 0;
        return "'" + (endsVowel ? "n" : "") + v + "n";
    }

    private int personRow(Gfx g, LobbyClient.Person p, int x, int y, int w, int h, int memberCount, boolean leader, int top, int bottom) {
        Theme t = ui.t;
        boolean visible = y + h > top && y < bottom;
        boolean me = p.id().equals(client.myId);
        int vy = Math.max(y, top), vh = Math.min(y + h, bottom) - vy;
        boolean hv = visible && vh > 0 && ui.hover(x, vy, w, vh);
        if (hv) Ui.round(g, x, y, w, h, 6, 0x14FFFFFF);
        boolean online = p.online() || me;
        Ui.round(g, x + 4, y + 7, 6, 6, 3, online ? t.ok : 0x66FFFFFF);
        boolean inLobby = client.members.stream().anyMatch(m -> m.id().equals(p.id()));
        String name = p.display() + (me ? "  " + Tr.t("(sen)") : "");
        String sub = !online ? Tr.t("Çevrimdışı") : p.singleplayer() ? Tr.t("Tek oyunculu dünyada")
                : p.server() != null ? (p.serverName() != null ? p.serverName() : p.server()) : inLobby ? Tr.t("Lobide") : Tr.t("Menüde");
        if (p.leader()) sub = Tr.t("Lider") + " · " + sub;
        if (!p.verified()) sub = Tr.t("Minecraft hesabı doğrulanmamış");
        String action = null;
        if (inLobby && leader && !me) action = Tr.t("Çıkar");
        else if (!inLobby && p.lobbyJoinable() && p.online()) action = Tr.t("Katıl");
        else if (!inLobby && p.online() && p.verified() && memberCount < 7) action = Tr.t("Davet et");
        int textW = w - 16;
        if (action != null) {
            int aw = small(g, action) + 10;
            int bx = x + w - aw - 2;
            boolean ah = visible && ui.hover(bx, y + 5, aw, 12);
            boolean kick = action.equals(Tr.t("Çıkar"));
            Ui.round(g, bx, y + 5, aw, 12, 6, kick ? (ah ? 0xCCE5566E : 0x40E5566E) : ah ? t.accent | 0xFF000000 : Theme.alpha(t.accent, 0x50));
            smallText(g, action, bx + 5, y + 8, ah && !kick ? t.onAccent : 0xFFFFFFFF);
            if (visible && !client.busy() && ui.clicked(bx, y + 5, aw, 12)) {
                WestHud.game.click();
                if (kick) client.kick(p.id());
                else if (action.equals(Tr.t("Katıl"))) client.join(p.lobbyId());
                else client.invite(p.id());
            }
            textW = bx - x - 18;
        }
        smallText(g, ui.fit(name, Math.round(textW / 0.8f)), x + 14, y + 3, 0xFFFFFFFF);
        smallText(g, ui.fit(sub, Math.round(textW / 0.8f)), x + 14, y + 12, 0x88FFFFFF);
        // Satıra tıklayınca ek seçenek (engelle)
        if (visible && vh > 0 && !me && ui.clicked(x, vy, w, vh)) expanded = p.id().equals(expanded) ? null : p.id();
        y += h;
        if (p.id().equals(expanded)) {
            String b = Tr.t("Engelle");
            int bw2 = small(g, b) + 12;
            boolean bh = visible && ui.hover(x + 14, y, bw2, 13);
            Ui.round(g, x + 14, y, bw2, 13, 6, bh ? 0xCCE5566E : 0x30E5566E);
            smallText(g, b, x + 20, y + 3, 0xFFFFFFFF);
            if (visible && ui.clicked(x + 14, y, bw2, 13)) {
                WestHud.game.click();
                client.block(p.id());
                expanded = null;
            }
            y += 18;
        }
        return y;
    }

    /** Lobi kullanılamıyorken nedeni (uydurma veri yok) */
    private String statusText() {
        return switch (client.status) {
            case NO_BRIDGE -> Tr.t("Arkadaşlarını lobine davet etmek için oyunu West Client'tan aç.");
            case NO_ACCOUNT -> Tr.t("Arkadaşlarını görmek ve davet etmek için West Client'ta West hesabına giriş yap.");
            case OFFLINE_ACCOUNT -> Tr.t("Lobi, Microsoft ile doğrulanmış bir Minecraft hesabı ister. Çevrimdışı hesapla arkadaş lobisi kullanılamaz.");
            case VERIFYING -> Tr.t("Minecraft hesabın doğrulanıyor…");
            case UNVERIFIED -> Tr.t("Minecraft hesabın doğrulanamadı.");
            case ERROR -> Tr.t("Lobi sunucusuna ulaşılamadı.");
            default -> Tr.t("Lobi sunucusuna bağlanılıyor…");
        };
    }

    private String statusButton() {
        return client.status == LobbyClient.Status.UNVERIFIED || client.status == LobbyClient.Status.ERROR ? Tr.t("Tekrar dene") : null;
    }

    private void statusMessage(Gfx g, int x, int y, int w) {
        for (String line : wrap(g, statusText(), Math.round(w / 0.8f))) {
            smallText(g, line, x, y, 0xBBFFFFFF);
            y += 9;
        }
        String button = statusButton();
        if (button != null && outlineButton("retry", button, null, x, y + 4, small(g, button) + 22, 15, true)) {
            if (client.status == LobbyClient.Status.UNVERIFIED) client.verify(WestHud.game);
            else client.refreshNow();
        }
    }

    // ───────── Sol alt: bilgi paneli ─────────

    private void infoPanel(Gfx g, int sh) {
        Config.Data d = WestHud.config.data;
        Game game = WestHud.game;
        List<String[]> rows = new ArrayList<>();
        for (int i = 0; i < INFO_KEYS.length; i++) {
            if (!d.lobbyInfo.getOrDefault(INFO_KEYS[i], true)) continue;
            String v = switch (INFO_KEYS[i]) {
                case "fps" -> String.valueOf(game.fps());
                case "version" -> game.minecraftVersion();
                case "loader" -> game.loaderName() + " · " + Tr.t("{0} mod", game.mods().size());
                // Lobi sunucusuna gerçek gecikme (Realtime nabzı); ölçülemiyorsa "yok"
                case "ping" -> client.pingMs >= 0 ? client.pingMs + " ms" : Tr.t("yok");
                case "clock" -> LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"));
                default -> game.playerName();
            };
            rows.add(new String[] { Tr.t(INFO_NAMES[i]), v });
        }
        infoRight = 0;
        if (rows.isEmpty()) return;
        int w = 0;
        for (String[] r : rows) w = Math.max(w, small(g, r[0]) + small(g, r[1]) + 18);
        w = Math.max(w, 90);
        infoRight = 10 + w;
        int h = rows.size() * 10 + 10;
        int x = 10, y = sh - h - 10;
        glass(g, x, y, w, h, 8);
        int cy = y + 6;
        for (String[] r : rows) {
            smallText(g, r[0], x + 7, cy, 0x99FFFFFF);
            smallText(g, r[1], x + w - 7 - small(g, r[1]), cy, 0xFFFFFFFF);
            cy += 10;
        }
    }

    // ───────── Sağ alt: Oyna kartı ─────────

    private int playCard(Gfx g, int sw, int sh) {
        Theme t = ui.t;
        int w = 104, h = 58;
        int x = sw - w - 10, y = sh - h - 10;
        boolean hv = ui.hover(x, y, w, h);
        float hh = hov("play", hv);
        glass(g, x, y, w, h, 10);
        if (hh > 0.01f) Ui.outline(g, x, y, w, h, 10, Theme.alpha(t.accent, (int) (0xCC * hh)));
        bigText(g, Tr.t("Oyna"), x + 9, y + 8, 0xFFFFFFFF, 1.25f);
        Ui.round(g, x + w - 24, y + 6, 16, 16, 5, t.accent | 0xFF000000);
        Icons.draw(g, Icon.PLAY, x + w - 20, y + 10, 8, t.onAccent);
        int friendsOnServers = (int) client.friends.stream().filter(f -> f.online() && f.server() != null).count();
        int nServers = servers == null ? 0 : servers.size(), nWorlds = WestHud.game.worlds(999).size();
        int tw = Math.round((w - 16) / 0.8f);
        int ry = y + 28;
        smallText(g, ui.fit(Tr.t("Çok Oyunculu") + " · " + Tr.t("{0} sunucu", nServers), tw), x + 9, ry, 0xEEFFFFFF);
        if (friendsOnServers > 0) smallText(g, ui.fit(Tr.t("{0} arkadaş sunucuda", friendsOnServers), tw), x + 9, ry += 9, t.accent | 0xFF000000);
        smallText(g, ui.fit(Tr.t("Tek Oyunculu") + " · " + Tr.t("{0} dünya", nWorlds), tw), x + 9, ry + 11, 0xEEFFFFFF);
        if (ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            playTab = 0;
            playScroll = 0;
            servers = WestHud.game.servers(64);
            modal = Modal.PLAY;
        }
        return x;
    }

    // ───────── Biyom seçici (alt orta) ─────────

    private void biomePicker(Gfx g, int sw, int sh, int cardX) {
        Theme t = ui.t;
        LobbyBiome[] all = LobbyBiome.values();
        boolean locked = client.ready() && !client.amLeader();
        int pad = 4, gap = 1, h = 16;
        int total = 0;
        int[] ws = new int[all.length];
        for (int i = 0; i < all.length; i++) {
            ws[i] = small(g, Tr.t(all[i].name)) + pad * 2;
            total += ws[i] + (i > 0 ? gap : 0);
        }
        int x = (sw - total) / 2, y = sh - h - 14;
        // Sol alt panel ya da Oyna kartıyla çakışıyorsa önce boşluğa ortala, olmazsa yukarı al
        if (x - 4 < infoRight + 6 || x + total + 4 > cardX - 6) {
            int gapL = infoRight + 10, gapR = cardX - 10;
            if (gapR - gapL >= total + 8) x = gapL + 4 + (gapR - gapL - total - 8) / 2;
            else y = sh - h - 88;
        }
        pickerTop = y - 4;
        glass(g, x - 4, y - 4, total + 8, h + 8, 12);
        for (int i = 0; i < all.length; i++) {
            boolean on = all[i] == biome;
            boolean hv = !locked && ui.hover(x, y, ws[i], h);
            if (on) Ui.round(g, x, y, ws[i], h, 8, locked ? 0x55FFFFFF : t.accent | 0xFF000000);
            else if (hv) Ui.round(g, x, y, ws[i], h, 8, 0x22FFFFFF);
            String label = Tr.t(all[i].name);
            smallText(g, label, x + pad, y + 5, locked ? (on ? 0xFFFFFFFF : 0x66FFFFFF) : on ? t.onAccent : 0xEEFFFFFF);
            if (!on && !locked && ui.clicked(x, y, ws[i], h)) {
                WestHud.game.click();
                biome = all[i];
                particles.clear();
                WestHud.config.data.lobbyBiome = biome.id;
                WestHud.save();
                if (client.ready()) client.setBiome(biome.id);
            }
            x += ws[i] + gap;
        }
        if (locked) {
            String s = Tr.t("Biyomu lobi lideri seçer");
            smallText(g, s, (sw - small(g, s)) / 2, y - 14, 0xCCFFFFFF);
        }
    }

    // ───────── Davet bildirimi (üst orta) ─────────

    /** Sol panel ile sağdaki bölümler arasına sığan iki satırlık bildirim; 1 = onay, 2 = ret, 0 = yok */
    private int banner(Gfx g, String id, int sw, int y, Icon icon, String title, String sub, String ok, String no, int[] outH) {
        Theme t = ui.t;
        int left = 10 + clamp(sw / 4, 140, 190) + 8, right = sw - 104 - 10 - 8;
        int maxW = right - left;
        int okW = g.textBoldWidth(ok) + 16, noW = no == null ? 0 : g.textBoldWidth(no) + 16;
        int w = Math.min(maxW, Math.max(Math.max(g.textBoldWidth(title), small(g, sub == null ? "" : sub)) + 40, okW + noW + 44));
        int h = 44;
        int x = left + (maxW - w) / 2;
        Ui.round(g, x, y, w, h, 10, 0xEC0E1016);
        Ui.outline(g, x, y, w, h, 10, Theme.alpha(t.accent, 0xCC));
        Ui.round(g, x + 8, y + 8, 14, 14, 7, Theme.alpha(t.accent, 0x40));
        Icons.draw(g, icon, x + 11, y + 11, 8, t.accent | 0xFF000000);
        g.textBold(ui.fit(title, w - 36), x + 28, y + 7, 0xFFFFFFFF, false);
        if (sub != null) smallText(g, ui.fit(sub, Math.round((w - 36) / 0.8f)), x + 28, y + 18, 0xAAFFFFFF);
        int bx = x + w - okW - noW - (no == null ? 8 : 12);
        int r = 0;
        if (accentButton(id + "-ok", ok, null, bx, y + h - 19, okW, 14)) r = 1;
        if (no != null && outlineButton(id + "-no", no, null, bx + okW + 4, y + h - 19, noW, 14, false)) r = 2;
        outH[0] = h;
        return r;
    }

    /** Lobi daveti; altındaki boş y'yi döner */
    private int inviteBanner(Gfx g, int sw) {
        int y = 34;
        if (!client.ready() || client.invites.isEmpty()) return y;
        LobbyClient.Invite inv = client.invites.get(0);
        int[] h = new int[1];
        int r = banner(g, "inv", sw, y, Icon.USERS, Tr.t("{0} seni lobisine davet etti", inv.fromName()), Tr.t("Lobiye ışınlanırsın"), Tr.t("Katıl"), Tr.t("Reddet"), h);
        if (r == 1) client.accept(inv.id());
        else if (r == 2) client.decline(inv.id());
        return y + h[0] + 6;
    }

    /** Arkadaşın dünyasını paylaştı (West sosyal daveti) */
    private void worldInviteBanner(Gfx g, int sw, int y) {
        var soc = dev.west.hud.social.SocialClient.INSTANCE;
        for (var inv : soc.invites) {
            String key = inv.from().id() + "|" + inv.at();
            if (dismissedWorldInvites.contains(key)) continue;
            boolean fits = inv.version() == null || inv.version().isEmpty() || inv.version().equals(WestHud.game.minecraftVersion());
            String sub = inv.world() + (inv.version() == null || inv.version().isEmpty() ? "" : " · " + inv.version());
            if (!fits) sub = Tr.t("Bu davet için launcher'dan {0} instance'ı aç", inv.version());
            int[] h = new int[1];
            int r = banner(g, "winv", sw, y, Icon.SHARE, Tr.t("{0} seni dünyasına davet etti", inv.from().display()), sub, fits ? Tr.t("Katıl") : Tr.t("Tamam"), fits ? Tr.t("Yoksay") : null, h);
            if (r == 1 && fits) {
                dismissedWorldInvites.add(key);
                WestHud.game.connect(inv.world(), inv.address());
            } else if (r != 0) dismissedWorldInvites.add(key);
            return;
        }
    }

    private void toastLine(Gfx g, int sw) {
        if (toast == null || System.currentTimeMillis() - toastAt > 4500) return;
        float a = Math.min(1, (4500 - (System.currentTimeMillis() - toastAt)) / 400f);
        int w = g.textWidth(toast) + 20;
        int x = (sw - w) / 2, y = 64;
        Ui.round(g, x, y, w, 16, 8, Theme.alpha(0xE00B0D14, (int) (0xE0 * a)));
        g.text(toast, x + 10, y + 4, Theme.alpha(0xFFFFFFFF, (int) (255 * a)), false);
    }

    // ───────── Oyna penceresi ─────────

    private void playWindow(Gfx g, int sw, int sh) {
        Theme t = ui.t;
        Game game = WestHud.game;
        int w = Math.min(sw - 40, 380), h = Math.min(sh - 40, 250);
        int x = (sw - w) / 2, y = (sh - h) / 2;
        g.blurBehind();
        glass(g, x, y, w, h, 12);
        Ui.round(g, x, y, w, h, 12, 0x60000000);
        String[] tabs = { Tr.t("Çok Oyunculu"), Tr.t("Tek Oyunculu") };
        int tx = x + 10;
        for (int i = 0; i < 2; i++) {
            int tw = g.textBoldWidth(tabs[i]) + 18;
            boolean on = playTab == i;
            boolean hv = ui.hover(tx, y + 10, tw, 18);
            Ui.round(g, tx, y + 10, tw, 18, 9, on ? t.accent | 0xFF000000 : hv ? 0x30FFFFFF : 0x18FFFFFF);
            g.textBold(tabs[i], tx + 9, y + 15, on ? t.onAccent : 0xEEFFFFFF, false);
            if (!on && ui.clicked(tx, y + 10, tw, 18)) {
                game.click();
                playTab = i;
                playScroll = 0;
            }
            tx += tw + 6;
        }
        if (iconButton("play-close", Icon.CLOSE, x + w - 26, y + 9, 18, null, 0)) modal = Modal.NONE;
        int listX = x + 10, listY = y + 36, listW = w - 20, listH = h - 36 - 30;
        int rowH = 30;
        g.scissor(listX, listY, listX + listW, listY + listH);
        int ry = listY - Math.round(playScroll);
        int n;
        if (playTab == 0) {
            List<Game.ServerInfo> list = servers == null ? List.of() : servers;
            n = list.size();
            if (n == 0) smallText(g, Tr.t("Sunucu listen boş. Aşağıdan sunucu ekleyebilirsin."), listX + 4, listY + 6, 0x99FFFFFF);
            for (int i = 0; i < n; i++, ry += rowH + 4) {
                if (ry + rowH < listY || ry > listY + listH) continue;
                Game.ServerInfo s = list.get(i);
                Ui.round(g, listX, ry, listW, rowH, 8, 0x1CFFFFFF);
                Icons.draw(g, Icon.SERVER, listX + 8, ry + 9, 12, 0xCCFFFFFF);
                int textW = listW - 150;
                g.textBold(ui.fit(s.name(), textW), listX + 28, ry + 5, 0xFFFFFFFF, false);
                smallText(g, ui.fit(s.address(), Math.round(textW / 0.8f)), listX + 28, ry + 17, 0x88FFFFFF);
                // Gerçek durum: oyuncu sayısı ve ping (ölçülemiyorsa yazıyla)
                Game.ServerStatus st = game.serverStatus(s.address());
                String stat = st == null || st.state() == 0 ? Tr.t("Sorgulanıyor…") : st.state() == 2 ? Tr.t("Ulaşılamıyor")
                        : st.online() + "/" + st.max() + "  ·  " + (st.ping() >= 0 ? st.ping() + " ms" : Tr.t("yok"));
                if (st != null && st.state() == 3) stat += "  ·  " + Tr.t("Sürüm uyumsuz");
                smallText(g, stat, listX + listW - 62 - small(g, stat), ry + 6, st != null && st.state() == 2 ? 0xFFE5566E : 0xCCFFFFFF);
                List<String> here = new ArrayList<>();
                for (LobbyClient.Person f : client.friends) if (f.online() && f.server() != null && f.server().equalsIgnoreCase(s.address())) here.add(f.display());
                if (!here.isEmpty()) {
                    String fs = here.size() == 1 ? Tr.t("{0} burada", here.get(0)) : Tr.t("{0} arkadaşın burada", here.size());
                    smallText(g, fs, listX + listW - 62 - small(g, fs), ry + 17, t.accent | 0xFF000000);
                }
                if (accentButton("join" + i, Tr.t("Bağlan"), null, listX + listW - 56, ry + 7, 50, 16)) {
                    modal = Modal.NONE;
                    game.joinServer(i);
                }
            }
        } else {
            List<Game.WorldInfo> list = game.worlds(256);
            n = list.size();
            if (n == 0) smallText(g, Tr.t("Henüz dünyan yok. Aşağıdan yeni bir dünya oluşturabilirsin."), listX + 4, listY + 6, 0x99FFFFFF);
            for (int i = 0; i < n; i++, ry += rowH + 4) {
                if (ry + rowH < listY || ry > listY + listH) continue;
                Game.WorldInfo wi = list.get(i);
                Ui.round(g, listX, ry, listW, rowH, 8, 0x1CFFFFFF);
                if (!g.worldIcon(wi.id(), wi.iconPath(), listX + 5, ry + 5, 20)) Icons.draw(g, Icon.WORLD, listX + 8, ry + 9, 12, 0xCCFFFFFF);
                int textW = listW - 120;
                g.textBold(ui.fit(wi.name(), textW), listX + 30, ry + 5, 0xFFFFFFFF, false);
                String mode = Tr.t(MODES[Math.max(0, Math.min(3, wi.mode()))]) + (wi.hardcore() ? " · " + Tr.t("Zorlu") : "");
                smallText(g, mode + "  ·  " + ago(wi.lastPlayed()), listX + 30, ry + 17, 0x88FFFFFF);
                if (accentButton("world" + i, Tr.t("Oyna"), null, listX + listW - 56, ry + 7, 50, 16)) {
                    modal = Modal.NONE;
                    game.joinWorld(wi.id());
                }
            }
        }
        g.noScissor();
        float max = Math.max(0, n * (rowH + 4) - 4 - listH);
        playScroll = Math.max(0, Math.min(max, playScroll));
        String add = playTab == 0 ? Tr.t("+ Sunucu ekle") : Tr.t("+ Yeni dünya");
        int aw = g.textBoldWidth(add) + 20;
        if (outlineButton("add", add, null, x + 10, y + h - 26, aw, 18, true)) {
            modal = Modal.NONE;
            game.open(playTab == 0 ? Game.Target.ADD_SERVER : Game.Target.CREATE_WORLD);
        }
    }

    private static String ago(long millis) {
        long s = Math.max(0, (System.currentTimeMillis() - millis) / 1000);
        if (s < 3600) return Tr.t("{0} dk önce", Math.max(1, s / 60));
        if (s < 86400) return Tr.t("{0} sa önce", s / 3600);
        return Tr.t("{0} gün önce", s / 86400);
    }

    // ───────── Modül menüsü ─────────

    private void modulesWindow(Gfx g, int sw, int sh) {
        Theme t = ui.t;
        Config.Data d = WestHud.config.data;
        int w = Math.min(sw - 40, 320), h = Math.min(sh - 40, 260);
        int x = (sw - w) / 2, y = (sh - h) / 2;
        g.blurBehind();
        glass(g, x, y, w, h, 12);
        Ui.round(g, x, y, w, h, 12, 0x60000000);
        g.textBold(Tr.t("Lobi modülleri"), x + 12, y + 12, 0xFFFFFFFF, false);
        if (iconButton("mod-close", Icon.CLOSE, x + w - 26, y + 8, 18, null, 0)) modal = Modal.NONE;
        int top = y + 30, bottom = y + h - 8;
        g.scissor(x, top, x + w, bottom);
        int cy = top - Math.round(moduleScroll);
        int col = x + 12, right = x + w - 12;
        boolean changed = false;

        cy = section(g, Tr.t("Bilgi paneli"), col, cy);
        for (int i = 0; i < INFO_KEYS.length; i++) {
            boolean on = d.lobbyInfo.getOrDefault(INFO_KEYS[i], true);
            g.text(Tr.t(INFO_NAMES[i]), col, cy + 2, 0xEEFFFFFF, false);
            boolean nv = ui.toggle(on, right - 22, cy);
            if (nv != on) {
                d.lobbyInfo.put(INFO_KEYS[i], nv);
                changed = true;
            }
            cy += 16;
        }
        cy = section(g, Tr.t("Menü tuşu"), col, cy + 4);
        int segW = (right - col) / KEYS.length;
        int ki = keyIndex();
        for (int i = 0; i < KEYS.length; i++) {
            int bx = col + i * segW;
            boolean on = i == ki, hv = ui.hover(bx, cy, segW - 4, 16);
            Ui.round(g, bx, cy, segW - 4, 16, 8, on ? t.accent | 0xFF000000 : hv ? 0x30FFFFFF : 0x18FFFFFF);
            String l = Tr.t(KEY_NAMES[i]);
            g.text(l, bx + (segW - 4 - g.textWidth(l)) / 2, cy + 4, on ? t.onAccent : 0xEEFFFFFF, false);
            if (!on && ui.clicked(bx, cy, segW - 4, 16)) {
                WestHud.game.click();
                d.lobbyMenuKey = KEYS[i];
                changed = true;
            }
        }
        cy += 20;
        smallText(g, Tr.t("Esc dışında bir tuş seçilirse Esc yalnızca açık pencereleri kapatır."), col, cy, 0x88FFFFFF);
        cy += 14;
        cy = section(g, Tr.t("Görünüm"), col, cy);
        String[][] toggles = { { "cinematic", Tr.t("Sinematik kamera kayması") }, { "sound", Tr.t("Lobi sesleri (ışınlanma)") },
                { "light", Tr.t("Hafif lobi (3B dünya çizilmez)") } };
        for (String[] tg : toggles) {
            boolean on = switch (tg[0]) {
                case "cinematic" -> d.lobbyCinematic;
                case "sound" -> d.lobbySound;
                default -> d.lobbyLight;
            };
            g.text(tg[1], col, cy + 2, 0xEEFFFFFF, false);
            boolean nv = ui.toggle(on, right - 22, cy);
            if (nv != on) {
                switch (tg[0]) {
                    case "cinematic" -> d.lobbyCinematic = nv;
                    case "sound" -> d.lobbySound = nv;
                    default -> d.lobbyLight = nv;
                }
                changed = true;
            }
            cy += 16;
        }
        g.text(Tr.t("Vurgu rengi"), col, cy + 2, 0xEEFFFFFF, false);
        int sx = right - Theme.ACCENTS.length * 13 + 4;
        for (int c : Theme.ACCENTS) {
            if (ui.swatch(c, (d.accent & 0xFFFFFF) == c, sx, cy + 2, 9)) {
                d.accent = c;
                changed = true;
            }
            sx += 13;
        }
        cy += 18;
        // Gizlilik (sunucuda saklanır)
        cy = section(g, Tr.t("Gizlilik"), col, cy + 2);
        if (client.ready()) {
            boolean o = client.showOnline, s = client.showServer, j = client.allowJoin;
            String[][] pr = { { "o", Tr.t("Arkadaşlarım çevrimiçi olduğumu görsün") }, { "s", Tr.t("Hangi sunucuda olduğumu göster") },
                    { "j", Tr.t("Arkadaşlarım sunucuma katılabilsin") } };
            for (String[] p : pr) {
                boolean on = p[0].equals("o") ? o : p[0].equals("s") ? s : j;
                g.text(ui.fit(p[1], right - col - 30), col, cy + 2, 0xEEFFFFFF, false);
                boolean nv = ui.toggle(on, right - 22, cy);
                if (nv != on) {
                    if (p[0].equals("o")) o = nv;
                    else if (p[0].equals("s")) s = nv;
                    else j = nv;
                    client.settings(o, s, j);
                }
                cy += 16;
            }
        } else {
            smallText(g, Tr.t("Gizlilik ayarları lobiye bağlanınca açılır."), col, cy, 0x88FFFFFF);
            cy += 12;
        }
        for (String line : wrap(g, Tr.t("Lobi için West hesabın, doğrulanmış Minecraft adın ve UUID'n, çevrimiçi durumun, (izin verirsen) bulunduğun sunucunun adresi, lobi üyeliğin ve davetler saklanır. Bunları yalnızca arkadaşların görür; şifre ya da Minecraft erişim anahtarı saklanmaz. Hepsini aşağıdan silebilirsin."), Math.round((right - col) / 0.8f))) {
            smallText(g, line, col, cy, 0x88FFFFFF);
            cy += 9;
        }
        cy += 4;
        if (client.ready() || client.status == LobbyClient.Status.UNVERIFIED) {
            String del = Tr.t("Lobi verilerimi sil");
            if (outlineButton("del", del, null, col, cy, g.textBoldWidth(del) + 20, 16, false)) modal = Modal.DELETE;
            cy += 22;
        }
        cy = section(g, Tr.t("Diğer"), col, cy + 2);
        String wm = Tr.t("West menüsü"), classic = Tr.t("Klasik ana menüye geç");
        if (outlineButton("west", wm, Icon.GEAR, col, cy, g.textBoldWidth(wm) + 30, 16, false)) {
            modal = Modal.NONE;
            WestHud.game.openWestScreen(false);
        }
        if (outlineButton("classic", classic, null, col + g.textBoldWidth(wm) + 36, cy, g.textBoldWidth(classic) + 20, 16, false)) {
            d.lobby = false;
            WestHud.save();
            go(new HomeScreen());
        }
        cy += 24;
        g.noScissor();
        float content = cy + Math.round(moduleScroll) - top;
        moduleScroll = Math.max(0, Math.min(Math.max(0, content - (bottom - top)), moduleScroll));
        if (changed) WestHud.save();
    }

    private int section(Gfx g, String title, int x, int y) {
        smallText(g, title.toUpperCase(Locale.ROOT), x, y + 2, ui.t.accent | 0xFF000000);
        return y + 14;
    }

    private void deleteWindow(Gfx g, int sw, int sh) {
        int w = Math.min(sw - 40, 260), h = 92;
        int x = (sw - w) / 2, y = (sh - h) / 2;
        glass(g, x, y, w, h, 12);
        Ui.round(g, x, y, w, h, 12, 0x80000000);
        g.textBold(Tr.t("Lobi verilerin silinsin mi?"), x + 12, y + 12, 0xFFFFFFFF, false);
        int cy = y + 28;
        for (String line : wrap(g, Tr.t("Minecraft hesap bağlantın, durumun, ayarların, lobi üyeliğin ve davetlerin sunucudan silinir. West hesabın ve arkadaşların kalır."), Math.round((w - 24) / 0.8f))) {
            smallText(g, line, x + 12, cy, 0xAAFFFFFF);
            cy += 9;
        }
        if (outlineButton("del-no", Tr.t("Vazgeç"), null, x + w - 130, y + h - 24, 56, 16, false)) modal = Modal.MODULES;
        if (accentButton("del-yes", Tr.t("Sil"), null, x + w - 68, y + h - 24, 56, 16)) {
            client.deleteMyData(() -> say(Tr.t("Lobi verilerin silindi")));
            modal = Modal.NONE;
        }
    }

    // ───────── Gökyüzü ─────────

    private void sky(Gfx g, int sw, int sh, float time) {
        int top = biome.skyTop, hor = biome.skyHorizon;
        float hy = Math.max(sh * 0.15f, Math.min(sh * 0.75f, frame.camera.horizonY()));
        g.gradient(0, 0, sw, Math.round(hy), top, hor);
        if (WestHud.config.data.lobbyLight) g.gradient(0, Math.round(hy), sw, sh, Theme.mix(hor, 0xFF000000, 0.35f), Theme.mix(hor, 0xFF000000, 0.65f));
        else g.fill(0, Math.round(hy), sw, sh, hor);
        if (biome == LobbyBiome.END || biome == LobbyBiome.SNOWY) stars(g, sw, Math.round(hy), time, biome == LobbyBiome.END ? 1f : 0.35f);
    }

    private static final float[][] STARS = new float[140][];

    static {
        Random r = new Random(7);
        for (int i = 0; i < STARS.length; i++) STARS[i] = new float[] { r.nextFloat(), r.nextFloat(), r.nextFloat() * 6.28f, 0.5f + r.nextFloat() };
    }

    private static void stars(Gfx g, int sw, int maxY, float time, float strength) {
        for (float[] s : STARS) {
            int x = Math.round(s[0] * sw), y = Math.round(s[1] * maxY * 0.95f);
            float tw = 0.55f + 0.45f * (float) Math.sin(time * 1.3f * s[3] + s[2]);
            int a = Math.round(200 * tw * strength * (1 - (float) y / Math.max(1, maxY)));
            if (a <= 4) continue;
            g.fill(x, y, x + 1, y + 1, (a << 24) | 0xFFFFFF);
        }
    }

    // ───────── Parçacıklar (kar, yaprak, kıvılcım…) ─────────

    /** p: x y z hız_x hız_y hız_z yaşam faz */
    private void particles(Gfx g, int sw, int sh) {
        LobbyBiome.Particle kind = biome.particle;
        if (kind == LobbyBiome.Particle.NONE) {
            particles.clear();
            return;
        }
        int want = kind == LobbyBiome.Particle.SNOW ? 260 : kind == LobbyBiome.Particle.PETALS ? 120 : kind == LobbyBiome.Particle.EMBERS ? 110 : 70;
        if (WestHud.config.data.lobbyLight || WestHud.config.data.performanceMode) want /= 3;
        float cx = frame.camera.target.x, cz = frame.camera.target.z;
        while (particles.size() > want) particles.remove(particles.size() - 1);
        while (particles.size() < want) particles.add(spawn(kind, cx, cz, true));
        for (int i = 0; i < particles.size(); i++) {
            float[] p = particles.get(i);
            p[0] += p[3] * bdt;
            p[1] += p[4] * bdt;
            p[2] += p[5] * bdt;
            p[6] -= bdt;
            if (kind == LobbyBiome.Particle.PETALS || kind == LobbyBiome.Particle.SNOW) p[0] += (float) Math.sin(bgTime * 0.9f + p[7]) * 0.3f * bdt;
            if (p[6] <= 0 || p[1] < LobbyScene.GROUND + 0.6f || p[1] > LobbyScene.GROUND + 22) {
                particles.set(i, spawn(kind, cx, cz, false));
                continue;
            }
            float[] s = frame.camera.project(p[0], p[1], p[2]);
            if (s == null || s[2] < 0.5f) continue;
            float size = Math.max(1f, 18f / s[2] * (kind == LobbyBiome.Particle.PETALS ? 1.4f : 1f));
            int sz = Math.round(size);
            float fade = Math.min(1, p[6] * 1.5f) * Math.max(0, Math.min(1, 1 - (s[2] - biome.fogStart) / (biome.fogEnd - biome.fogStart)));
            int col = switch (kind) {
                case SNOW -> 0xFFFFFF;
                case PETALS -> 0xF4B6CF;
                case EMBERS -> (i % 3 == 0) ? 0xFFC861 : 0xFF7A2E;
                case ENDER -> 0xC08BFF;
                case DUST -> 0xF3D2A6;
                default -> 0xFFFFFF;
            };
            int a = Math.round((kind == LobbyBiome.Particle.DUST ? 110 : 225) * fade);
            if (a < 6) continue;
            int x = Math.round(s[0]), y = Math.round(s[1]);
            if (x < -4 || y < -4 || x > sw + 4 || y > sh + 4) continue;
            if (kind == LobbyBiome.Particle.SNOW || kind == LobbyBiome.Particle.DUST) Ui.round(g, x, y, sz, sz, sz / 2, (a << 24) | col);
            else g.fill(x, y, x + sz, y + Math.max(1, sz - (kind == LobbyBiome.Particle.PETALS ? sz / 3 : 0)), (a << 24) | col);
        }
    }

    private float[] spawn(LobbyBiome.Particle kind, float cx, float cz, boolean anywhere) {
        float x = cx + (rnd.nextFloat() - 0.5f) * 44, z = cz - 2 + (rnd.nextFloat() - 0.6f) * 34;
        float baseY = LobbyScene.GROUND + 1;
        return switch (kind) {
            case SNOW -> new float[] { x, anywhere ? baseY + rnd.nextFloat() * 18 : baseY + 16 + rnd.nextFloat() * 4, z, 0.35f, -1.1f - rnd.nextFloat() * 0.8f, 0.1f, 30, rnd.nextFloat() * 6 };
            case PETALS -> new float[] { x, anywhere ? baseY + rnd.nextFloat() * 14 : baseY + 12 + rnd.nextFloat() * 4, z, 0.8f, -0.55f - rnd.nextFloat() * 0.4f, 0.2f, 40, rnd.nextFloat() * 6 };
            case EMBERS -> new float[] { x, anywhere ? baseY + rnd.nextFloat() * 10 : baseY + rnd.nextFloat(), z, (rnd.nextFloat() - 0.5f) * 0.4f, 0.6f + rnd.nextFloat() * 0.9f, (rnd.nextFloat() - 0.5f) * 0.4f, 4 + rnd.nextFloat() * 8, 0 };
            case ENDER -> new float[] { x, baseY + rnd.nextFloat() * 8, z, (rnd.nextFloat() - 0.5f) * 0.2f, 0.15f + rnd.nextFloat() * 0.2f, (rnd.nextFloat() - 0.5f) * 0.2f, 3 + rnd.nextFloat() * 6, 0 };
            default -> new float[] { x, baseY + rnd.nextFloat() * 8, z, 0.4f, 0.05f, 0.1f, 6 + rnd.nextFloat() * 8, 0 };
        };
    }

    /** Cam panel: yarı saydam koyu zemin, ince açık kenar */
    static void glass(Gfx g, int x, int y, int w, int h, int r) {
        // Karlı/açık sahnelerde de okunabilsin: koyu, hafif mavimsi cam; üstte ince parlama
        Ui.round(g, x, y + 1, w, h, r, 0x40000000);
        Ui.round(g, x, y, w, h, r, 0xD40D0F16);
        Ui.outline(g, x, y, w, h, r, 0x2AFFFFFF);
        g.fill(x + r, y + 1, x + w - r, y + 2, 0x18FFFFFF);
    }

    // ───────── Girdi ─────────

    @Override
    public void mouseClicked(double x, double y, int button) {
        if (wardrobe) {
            int sw = ui.g == null ? 0 : ui.g.width();
            if (button == 0 && x < sw / 2.0) {
                draggingModel = true;
                dragLastX = x;
                wardrobeSpin = 0;
            }
            if (wardrobePanel != null) wardrobePanel.mouseClicked(x, y, button);
        }
        super.mouseClicked(x, y, button);
    }

    @Override
    public void mouseDragged(double x, double y, int button) {
        if (draggingModel) {
            wardrobeYaw += (float) (x - dragLastX) * 1.6f;
            dragLastX = x;
        }
    }

    @Override
    public void mouseReleased(double x, double y, int button) {
        if (draggingModel) {
            draggingModel = false;
            wardrobeSpin = 0.5f;
        }
    }

    @Override
    public void mouseScrolled(double x, double y, double amount) {
        if (wardrobe) {
            if (wardrobePanel != null) wardrobePanel.mouseScrolled(x, y, amount);
            return;
        }
        if (modal == Modal.PLAY) playScroll -= (float) amount * 24;
        else if (modal == Modal.MODULES) moduleScroll -= (float) amount * 24;
        else if (hoveringList) friendScroll -= (float) amount * 20;
    }

    @Override
    public boolean keyPressed(int key) {
        int menuKey = KEY_CODES[keyIndex()];
        if (wardrobe && key == 256) {
            closeWardrobe();
            return true;
        }
        if (key == 256) {
            // Esc: açık pencereyi kapatır; menü tuşu Esc ise modül menüsünü açar
            if (modal == Modal.DELETE) modal = Modal.MODULES;
            else if (modal != Modal.NONE) modal = Modal.NONE;
            else if (menuKey == 256) modal = Modal.MODULES;
            return true;
        }
        if (key == menuKey) {
            modal = modal == Modal.MODULES ? Modal.NONE : Modal.MODULES;
            return true;
        }
        return false;
    }

    @Override
    public WestScreen escape() {
        return this;
    }
}
