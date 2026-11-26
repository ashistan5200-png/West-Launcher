package dev.west.hud.api;

/**
 * Küçük GUI alanlarında (yüksek arayüz ölçeği) West ekranlarının sıkışmaması için: çizimi k oranında küçültür ve
 * ekranı en az {@code minW}×{@code minH} mantıksal birim gibi gösterir. Çağıran {@link #begin()} ve {@link #end()}
 * arasında çizer; fare koordinatlarını {@link #toLogical(double)} ile çevirir.
 */
public final class ScaledGfx implements Gfx {
    private final Gfx g;
    public final float k;
    private final int w, h;

    public ScaledGfx(Gfx g, int minW, int minH) {
        this.g = g;
        this.k = Math.min(1f, Math.min(g.width() / (float) minW, g.height() / (float) minH));
        this.w = Math.round(g.width() / k);
        this.h = Math.round(g.height() / k);
    }

    /** Bu ölçek (kare başında sabit; fare dönüşümü için de kullanılır) */
    public static float factor(Gfx g, int minW, int minH) {
        return Math.min(1f, Math.min(g.width() / (float) minW, g.height() / (float) minH));
    }

    public void begin() {
        g.push();
        g.scale(k);
    }

    public void end() {
        g.pop();
    }

    public int toLogical(double v) {
        return (int) Math.floor(v / k);
    }

    @Override public int width() { return w; }
    @Override public int height() { return h; }
    @Override public void fill(int x1, int y1, int x2, int y2, int argb) { g.fill(x1, y1, x2, y2, argb); }
    @Override public void gradient(int x1, int y1, int x2, int y2, int a, int b) { g.gradient(x1, y1, x2, y2, a, b); }
    @Override public void text(String s, int x, int y, int argb, boolean shadow) { g.text(s, x, y, argb, shadow); }
    @Override public int textWidth(String s) { return g.textWidth(s); }
    @Override public int lineHeight() { return g.lineHeight(); }
    @Override public void push() { g.push(); }
    @Override public void pop() { g.pop(); }
    @Override public void translate(float x, float y) { g.translate(x, y); }
    @Override public void scale(float s) { g.scale(s); }
    @Override public void scissor(int x1, int y1, int x2, int y2) { g.scissor(x1, y1, x2, y2); }
    @Override public void noScissor() { g.noScissor(); }
    @Override public void blurBehind() { g.blurBehind(); }
    @Override public boolean item(int slot, int x, int y) { return g.item(slot, x, y); }
    @Override public int guiScale() { return g.guiScale(); }
    @Override public void smoothText(boolean on) { g.smoothText(on); }
    @Override public void panorama(float delta) { g.panorama(delta); }
    @Override public void playerFace(int x, int y, int size) { g.playerFace(x, y, size); }
    @Override public void textBold(String s, int x, int y, int argb, boolean shadow) { g.textBold(s, x, y, argb, shadow); }
    @Override public int textBoldWidth(String s) { return g.textBoldWidth(s); }
    @Override public void playerModel(int x, int y, int w, int h) { g.playerModel(x, y, w, h); }
    @Override public void image(String id, float x, float y, float w, float h, float sx, float sy, float sw, float sh, int color) { g.image(id, x, y, w, h, sx, sy, sw, sh, color); }
    @Override public int[] imageSize(String id) { return g.imageSize(id); }
    @Override public void playerStanding(int cx, int feetY, int height, float yaw) { g.playerStanding(cx, feetY, height, yaw); }
    @Override public void playerBust(int x, int y, int w, int h, float yaw) { g.playerBust(x, y, w, h, yaw); }
    @Override public boolean mask(String key, int pw, int ph, java.util.function.Supplier<byte[]> build, int x, int y, int color) { return g.mask(key, pw, ph, build, x, y, color); }
    @Override public void nextLayer() { g.nextLayer(); }
    @Override public boolean texture(String loc, int x, int y, int w, int h, float u, float v, int uw, int vh, int texW, int texH, int color) { return g.texture(loc, x, y, w, h, u, v, uw, vh, texW, texH, color); }
    @Override public boolean png(String key, byte[] png, int x, int y, int w, int h) { return g.png(key, png, x, y, w, h); }
    @Override public boolean worldIcon(String id, String iconPath, int x, int y, int size) { return g.worldIcon(id, iconPath, x, y, size); }
}
