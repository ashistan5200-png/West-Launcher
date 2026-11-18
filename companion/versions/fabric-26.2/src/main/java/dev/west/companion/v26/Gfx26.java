package dev.west.companion.v26;

import dev.west.hud.api.Gfx;
import net.minecraft.client.Minecraft;
import dev.west.hud.WestHud;
import net.minecraft.client.gui.Font;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.Style;
import net.minecraft.resources.Identifier;
import java.util.function.Consumer;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

/** 26.x çizim köprüsü (GuiGraphicsExtractor). */
public final class Gfx26 implements Gfx {
    private final GuiGraphicsExtractor g;
    private final Font font;
    private int scissorDepth;
    private boolean smooth;
    private final Consumer<Float> panorama;
    /** Pürüzsüz (TrueType) West yazı tipi: assets/west_companion/font/smooth.json */
    private static final Style SMOOTH = Style.EMPTY.withFont(new FontDescription.Resource(Identifier.fromNamespaceAndPath("west_companion", "smooth")));

    public Gfx26(GuiGraphicsExtractor g) {
        this(g, null);
    }

    Gfx26(GuiGraphicsExtractor g, Consumer<Float> panorama) {
        this.g = g;
        this.font = Minecraft.getInstance().font;
        this.panorama = panorama;
        this.smooth = WestHud.config == null || WestHud.config.data.smoothFont;
    }

    private static final Style BOLD = Style.EMPTY.withFont(new FontDescription.Resource(Identifier.fromNamespaceAndPath("west_companion", "smooth_bold")));

    private Component smooth(String s) {
        return Component.literal(s).setStyle(SMOOTH);
    }

    @Override
    public void textBold(String s, int x, int y, int argb, boolean shadow) {
        if (s == null || s.isEmpty() || (argb >>> 24) == 0) return;
        if (smooth) g.text(font, Component.literal(s).setStyle(BOLD), x, y, argb, shadow);
        else g.text(font, Component.literal(s).withStyle(net.minecraft.ChatFormatting.BOLD), x, y, argb, shadow);
    }

    @Override
    public int textBoldWidth(String s) {
        return s == null ? 0 : smooth ? font.width(Component.literal(s).setStyle(BOLD)) : font.width(Component.literal(s).withStyle(net.minecraft.ChatFormatting.BOLD));
    }

    private static java.util.function.Supplier<net.minecraft.world.entity.player.PlayerSkin> skin;

    @Override
    public void playerFace(int x, int y, int size) {
        Minecraft mc = Minecraft.getInstance();
        if (skin == null) skin = mc.getSkinManager().createLookup(mc.getGameProfile(), false);
        net.minecraft.client.gui.components.PlayerFaceExtractor.extractRenderState(g, skin.get(), x, y, size);
    }

    /** Ana menüdeki 3B oyuncu modeli (fareyle döndürülür) */
    public static net.minecraft.client.gui.components.PlayerSkinWidget model;
    public static long modelShown;

    @Override
    public void playerModel(int x, int y, int w, int h) {
        Minecraft mc = Minecraft.getInstance();
        if (skin == null) skin = mc.getSkinManager().createLookup(mc.getGameProfile(), false);
        if (model == null) model = new net.minecraft.client.gui.components.PlayerSkinWidget(w, h, mc.getEntityModels(), skin);
        model.setX(x);
        model.setY(y);
        model.setWidth(w);
        model.setHeight(h);
        model.extractRenderState(g, -1, -1, 0);
        modelShown = System.currentTimeMillis();
        // Sonraki çizimler (isim etiketi, kartlar) modelin üstünde kalsın
        g.nextStratum();
    }

    private static final java.util.Map<String, net.minecraft.client.gui.screens.FaviconTexture> ICONS = new java.util.HashMap<>();
    private static final java.util.Set<String> NO_ICON = new java.util.HashSet<>();

    @Override
    public boolean worldIcon(String id, String iconPath, int x, int y, int size) {
        if (iconPath == null || NO_ICON.contains(id)) return false;
        var tex = ICONS.get(id);
        if (tex == null) {
            try (var in = java.nio.file.Files.newInputStream(java.nio.file.Path.of(iconPath))) {
                var img = com.mojang.blaze3d.platform.NativeImage.read(in);
                tex = net.minecraft.client.gui.screens.FaviconTexture.forWorld(Minecraft.getInstance().getTextureManager(), id);
                tex.upload(img);
                ICONS.put(id, tex);
            } catch (Exception e) {
                NO_ICON.add(id);
                return false;
            }
        }
        g.blit(net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED, tex.textureLocation(), x, y, 0f, 0f, size, size, 64, 64, 64, 64);
        return true;
    }

    /** Arkadaki oyunu / panoramayı bulanıklaştır (karede bir kez) */
    @Override
    public void blurBehind() {
        // Minecraft karede yalnızca bir bulanıklaştırmaya izin verir; ikincisi tüm ekranı düşürmesin
        try {
            g.blurBeforeThisStratum();
        } catch (IllegalStateException ignored) {
        }
    }

    // ───── Görseller (arka plan fotoğrafı) ─────
    private static final java.util.Map<String, Identifier> IMAGES = new java.util.HashMap<>();
    private static final java.util.Map<String, int[]> IMAGE_SIZES = new java.util.HashMap<>();

    private static Identifier loadImage(String id) {
        if (IMAGES.containsKey(id)) return IMAGES.get(id);
        Identifier loc = null;
        try (var in = Gfx26.class.getResourceAsStream("/assets/west_companion/background/" + id + ".png")) {
            if (in != null) {
                var img = com.mojang.blaze3d.platform.NativeImage.read(in);
                IMAGE_SIZES.put(id, new int[] { img.getWidth(), img.getHeight() });
                loc = Identifier.fromNamespaceAndPath("west_companion", "bg_" + id);
                Minecraft.getInstance().getTextureManager().register(loc, new net.minecraft.client.renderer.texture.DynamicTexture(() -> "west bg", img));
            }
        } catch (Exception e) {
            WestHud.LOG.warn("West görseli yüklenemedi ({}): {}", id, e.toString());
        }
        IMAGES.put(id, loc);
        return loc;
    }

    @Override
    public int[] imageSize(String id) {
        return loadImage(id) == null ? null : IMAGE_SIZES.get(id);
    }

    @Override
    public void image(String id, float x, float y, float w, float h, float sx, float sy, float sw, float sh, int color) {
        Identifier loc = loadImage(id);
        if (loc == null) return;
        int[] size = IMAGE_SIZES.get(id);
        int ix = Math.round(x), iy = Math.round(y), iw = Math.round(x + w) - ix, ih = Math.round(y + h) - iy;
        if (iw <= 0 || ih <= 0) return;
        g.blit(net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED, loc, ix, iy, sx, sy, iw, ih, Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)), size[0], size[1], color);
    }

    /** Sağdaki dönen yarım gövde (ayrı model) */
    private static net.minecraft.client.gui.components.PlayerSkinWidget bust;

    @Override
    public void playerBust(int x, int y, int w, int h, float yaw) {
        Minecraft mc = Minecraft.getInstance();
        if (skin == null) skin = mc.getSkinManager().createLookup(mc.getGameProfile(), false);
        // Model, widget yüksekliğinin %91,3'ü kadar ve dikeyde ortalı çizilir. Görünen kısım: kafa + gövdenin yarısı (~%45)
        float modelPx = h / 0.45f;
        int full = Math.round(modelPx / 0.913f);
        int ww = Math.round(modelPx * 0.75f);
        if (bust == null) bust = new net.minecraft.client.gui.components.PlayerSkinWidget(ww, full, mc.getEntityModels(), skin);
        bust.setX(x + w / 2 - ww / 2);
        bust.setY(y - Math.round(full * 0.0435f) + 2);
        bust.setWidth(ww);
        bust.setHeight(full);
        var acc = (dev.west.companion.v26.mixin.PlayerSkinWidgetAccessor) bust;
        acc.west$setRotationY(yaw % 360f);
        acc.west$setRotationX(-4f);
        g.enableScissor(x, y, x + w, y + h);
        bust.extractRenderState(g, -1, -1, 0);
        g.disableScissor();
    }

    /** Ana menü sahnesindeki tam boy karakter (fareyle de döndürülebilir) */
    @Override
    public void playerStanding(int cx, int feetY, int height, float yaw) {
        Minecraft mc = Minecraft.getInstance();
        if (skin == null) skin = mc.getSkinManager().createLookup(mc.getGameProfile(), false);
        int full = Math.round(height / 0.913f);
        int ww = Math.round(full * 0.6f);
        if (model == null) model = new net.minecraft.client.gui.components.PlayerSkinWidget(ww, full, mc.getEntityModels(), skin);
        model.setX(cx - ww / 2);
        model.setY(feetY - Math.round(full * 0.9565f));
        model.setWidth(ww);
        model.setHeight(full);
        // Kullanıcı sürüklemiyorsa bakış yönünü sahne belirler
        if (!dragging) {
            var acc = (dev.west.companion.v26.mixin.PlayerSkinWidgetAccessor) model;
            acc.west$setRotationY(yaw);
            acc.west$setRotationX(-3f);
        }
        model.extractRenderState(g, -1, -1, 0);
        modelShown = System.currentTimeMillis();
    }

    /** WestHost sürükleme sırasında true yapar */
    public static boolean dragging;

    private static final java.util.Map<String, Identifier> MASKS = new java.util.HashMap<>();

    @Override
    public boolean mask(String key, int pw, int ph, java.util.function.Supplier<byte[]> build, int x, int y, int color) {
        if (pw <= 0 || ph <= 0 || pw > 1024 || ph > 1024) return false;
        Identifier id = MASKS.get(key);
        if (id == null) {
            byte[] a = build.get();
            var img = new com.mojang.blaze3d.platform.NativeImage(pw, ph, false);
            for (int py = 0; py < ph; py++)
                for (int px = 0; px < pw; px++) img.setPixel(px, py, ((a[py * pw + px] & 0xFF) << 24) | 0xFFFFFF);
            String path = "mask/" + key.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9._-]", "_");
            id = Identifier.fromNamespaceAndPath("west_companion", path);
            Minecraft.getInstance().getTextureManager().register(id, new net.minecraft.client.renderer.texture.DynamicTexture(() -> "west mask", img));
            MASKS.put(key, id);
        }
        g.blit(net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED, id, x, y, 0f, 0f, pw, ph, pw, ph, color);
        return true;
    }

    @Override
    public boolean lobby(dev.west.hud.lobby.LobbyFrame frame) {
        int w = g.guiWidth(), h = g.guiHeight();
        boolean ready = frame.light || LobbyRender26.mesh(frame.scene.biome) != null;
        var bounds = new net.minecraft.client.gui.navigation.ScreenRectangle(0, 0, w, h);
        g.guiRenderState.addPicturesInPictureState(new LobbyRender26.State(frame, 0, 0, w, h, 1f, null, bounds));
        // Sonraki çizimler (isim etiketleri, paneller) sahnenin üstünde kalsın
        g.nextStratum();
        return ready;
    }

    @Override
    public void nextLayer() {
        g.nextStratum();
    }

    @Override public void smoothText(boolean on) { smooth = on; }
    @Override public int guiScale() { return Math.max(1, Minecraft.getInstance().getWindow().getGuiScale()); }
    @Override public void panorama(float delta) { if (panorama != null) panorama.accept(delta); }

    @Override public int width() { return g.guiWidth(); }
    @Override public int height() { return g.guiHeight(); }

    @Override
    public void fill(int x1, int y1, int x2, int y2, int argb) {
        if (x2 > x1 && y2 > y1 && (argb >>> 24) != 0) g.fill(x1, y1, x2, y2, argb);
    }

    @Override
    public void gradient(int x1, int y1, int x2, int y2, int top, int bottom) {
        if (x2 > x1 && y2 > y1) g.fillGradient(x1, y1, x2, y2, top, bottom);
    }

    @Override
    public void text(String s, int x, int y, int argb, boolean shadow) {
        if (s == null || s.isEmpty() || (argb >>> 24) == 0) return;
        if (smooth) g.text(font, smooth(s), x, y, argb, shadow);
        else g.text(font, s, x, y, argb, shadow);
    }

    @Override public int textWidth(String s) { return s == null ? 0 : smooth ? font.width(smooth(s)) : font.width(s); }
    @Override public int lineHeight() { return font.lineHeight; }

    @Override public void push() { g.pose().pushMatrix(); }
    @Override public void pop() { g.pose().popMatrix(); }
    @Override public void translate(float x, float y) { g.pose().translate(x, y); }
    @Override public void scale(float s) { g.pose().scale(s, s); }

    @Override
    public void scissor(int x1, int y1, int x2, int y2) {
        g.enableScissor(x1, y1, Math.max(x1, x2), Math.max(y1, y2));
        scissorDepth++;
    }

    @Override
    public void noScissor() {
        if (scissorDepth > 0) {
            g.disableScissor();
            scissorDepth--;
        }
    }

    @Override
    public boolean item(int slot, int x, int y) {
        ItemStack s = stack(slot);
        if (s == null || s.isEmpty()) return false;
        g.item(s, x, y);
        g.itemDecorations(font, s, x, y);
        return true;
    }

    static ItemStack stack(int slot) {
        Player p = Minecraft.getInstance().player;
        if (p == null) return null;
        return switch (slot) {
            case 0 -> p.getItemBySlot(EquipmentSlot.HEAD);
            case 1 -> p.getItemBySlot(EquipmentSlot.CHEST);
            case 2 -> p.getItemBySlot(EquipmentSlot.LEGS);
            case 3 -> p.getItemBySlot(EquipmentSlot.FEET);
            case 4 -> p.getMainHandItem();
            case 5 -> p.getOffhandItem();
            default -> null;
        };
    }
}
