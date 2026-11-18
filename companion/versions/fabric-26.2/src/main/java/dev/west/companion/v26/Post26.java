package dev.west.companion.v26;

import com.mojang.blaze3d.pipeline.BlendFunction;
import com.mojang.blaze3d.pipeline.ColorTargetState;
import com.mojang.blaze3d.pipeline.RenderPipeline;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.textures.FilterMode;
import com.mojang.blaze3d.vertex.VertexConsumer;
import dev.west.hud.lobby.SoftTex;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.navigation.ScreenRectangle;
import net.minecraft.client.gui.render.TextureSetup;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.renderer.state.gui.GuiElementRenderState;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;
import org.joml.Matrix3x2f;
import org.jspecify.annotations.Nullable;

import java.util.function.Supplier;

/**
 * Lobinin ekran efektleri (26.x): yumuşak dokular (ışıma, vinyet, şerit) doğrusal süzgeçle ve isteğe
 * bağlı "ışık gibi" (eklemeli) karışımla; kenar bulanıklığı için sahne dokusunun maskeli yeniden çizimi.
 */
final class Post26 {
    private Post26() {}

    /** Eklemeli karışım: kaynak × alfa + hedef (parlama, ışık huzmesi) */
    private static RenderPipeline additive;

    static RenderPipeline additive() {
        if (additive == null) additive = RenderPipeline.builder(RenderPipelines.GUI_TEXTURED_SNIPPET)
                .withLocation(Identifier.fromNamespaceAndPath("west_companion", "pipeline/soft_additive"))
                .withColorTargetState(new ColorTargetState(BlendFunction.LIGHTNING))
                .build();
        return additive;
    }

    private static final DynamicTexture[] SOFT = new DynamicTexture[3];

    static TextureSetup soft(int kind) {
        DynamicTexture t = SOFT[kind];
        if (t == null) {
            int w = SoftTex.width(kind), h = SoftTex.height(kind);
            byte[] a = SoftTex.alpha(kind);
            NativeImage img = new NativeImage(w, h, false);
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++) img.setPixel(x, y, ((a[y * w + x] & 0xFF) << 24) | 0xFFFFFF);
            t = SOFT[kind] = new DynamicTexture(() -> "west soft " + kind, img);
        }
        return TextureSetup.singleTexture(t.getTextureView(), RenderSystem.getSamplerCache().getClampToEdge(FilterMode.LINEAR));
    }

    /** Yumuşak dokuyu döndürülmüş bir dörtgen olarak ekle */
    static void soft(GuiGraphicsExtractor g, int kind, float cx, float cy, float w, float h, float angle, int argb, boolean add) {
        if ((argb >>> 24) == 0 || w <= 0 || h <= 0) return;
        float c = (float) Math.cos(angle), s = (float) Math.sin(angle);
        float hw = w / 2, hh = h / 2;
        float[] lx = { -hw, -hw, hw, hw }, ly = { -hh, hh, hh, -hh }, us = { 0, 0, 1, 1 }, vs = { 0, 1, 1, 0 };
        float[] v = new float[16];
        int[] col = new int[4];
        for (int i = 0; i < 4; i++) {
            v[i * 4] = cx + lx[i] * c - ly[i] * s;
            v[i * 4 + 1] = cy + lx[i] * s + ly[i] * c;
            v[i * 4 + 2] = us[i];
            v[i * 4 + 3] = vs[i];
            col[i] = argb;
        }
        TextureSetup tex = soft(kind);
        Matrix3x2f pose = new Matrix3x2f(g.pose());
        g.guiRenderState.addGuiElement(new Quads(add ? additive() : RenderPipelines.GUI_TEXTURED, () -> tex, pose, v, col, bounds(v, pose, g)));
    }

    /**
     * Kenar bulanıklığı: bu noktaya kadar çizilenler (gök + sahne) oyunun bulanıklaştırmasından geçer, sonra
     * sahne dokusu ortası tam, kenarlara doğru saydamlaşan bir ızgarayla keskin olarak yeniden çizilir.
     */
    static boolean edgeBlur(GuiGraphicsExtractor g, float rx, float ry) {
        if (LobbyRender26.INSTANCE == null) return false;
        int w = g.guiWidth(), h = g.guiHeight();
        g.nextStratum();
        try {
            g.blurBeforeThisStratum();
        } catch (IllegalStateException e) {
            return false;
        }
        int nx = 24, ny = 14;
        float[] v = new float[nx * ny * 16];
        int[] col = new int[nx * ny * 4];
        int q = 0;
        for (int j = 0; j < ny; j++)
            for (int i = 0; i < nx; i++) {
                float[] fx = { (float) i / nx, (float) i / nx, (float) (i + 1) / nx, (float) (i + 1) / nx };
                float[] fy = { (float) j / ny, (float) (j + 1) / ny, (float) (j + 1) / ny, (float) j / ny };
                for (int k = 0; k < 4; k++) {
                    int o = (q * 4 + k) * 4;
                    v[o] = fx[k] * w;
                    v[o + 1] = fy[k] * h;
                    v[o + 2] = fx[k];
                    v[o + 3] = 1 - fy[k];
                    int m = Math.round(SoftTex.sharp(fx[k], fy[k], rx, ry) * 255);
                    // Sahne dokusu önceden çarpılmış alfalı: renk kanalları da maskeyle çarpılır
                    col[q * 4 + k] = (m << 24) | (m << 16) | (m << 8) | m;
                }
                q++;
            }
        Matrix3x2f pose = new Matrix3x2f(g.pose());
        Supplier<TextureSetup> tex = () -> {
            var view = ((dev.west.companion.v26.mixin.PipTextureAccessor) (Object) LobbyRender26.INSTANCE).west$textureView();
            return view == null ? null : TextureSetup.singleTexture(view, RenderSystem.getSamplerCache().getClampToEdge(FilterMode.NEAREST));
        };
        g.guiRenderState.addGuiElement(new Quads(RenderPipelines.GUI_TEXTURED_PREMULTIPLIED_ALPHA, tex, pose, v, col, new ScreenRectangle(0, 0, w, h)));
        g.nextStratum();
        return true;
    }

    private static ScreenRectangle bounds(float[] v, Matrix3x2f pose, GuiGraphicsExtractor g) {
        float x0 = Float.MAX_VALUE, y0 = Float.MAX_VALUE, x1 = -Float.MAX_VALUE, y1 = -Float.MAX_VALUE;
        for (int i = 0; i < v.length; i += 4) {
            x0 = Math.min(x0, v[i]);
            y0 = Math.min(y0, v[i + 1]);
            x1 = Math.max(x1, v[i]);
            y1 = Math.max(y1, v[i + 1]);
        }
        int ix = (int) Math.floor(x0), iy = (int) Math.floor(y0);
        return new ScreenRectangle(ix, iy, Math.max(1, (int) Math.ceil(x1) - ix), Math.max(1, (int) Math.ceil(y1) - iy)).transformMaxBounds(pose);
    }

    /** Dörtgen listesi: köşe başına x y u v ve renk */
    record Quads(RenderPipeline pipeline, Supplier<TextureSetup> tex, Matrix3x2f pose, float[] v, int[] col, ScreenRectangle bounds) implements GuiElementRenderState {
        @Override
        public void buildVertices(VertexConsumer c) {
            for (int i = 0, n = col.length; i < n; i++) c.addVertexWith2DPose(pose, v[i * 4], v[i * 4 + 1]).setUv(v[i * 4 + 2], v[i * 4 + 3]).setColor(col[i]);
        }

        @Override
        public TextureSetup textureSetup() {
            TextureSetup t = tex.get();
            return t == null ? TextureSetup.noTexture() : t;
        }

        @Override
        public @Nullable ScreenRectangle scissorArea() {
            return null;
        }
    }
}
