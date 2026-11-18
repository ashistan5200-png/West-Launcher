package dev.west.companion.v26;

import com.mojang.blaze3d.ProjectionType;
import com.mojang.blaze3d.buffers.GpuBufferSlice;
import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.QuadInstance;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import dev.west.hud.WestHud;
import dev.west.hud.lobby.LobbyBiome;
import dev.west.hud.lobby.LobbyFrame;
import dev.west.hud.lobby.LobbyLight;
import dev.west.hud.lobby.LobbyScene;
import dev.west.hud.lobby.SceneGen;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.navigation.ScreenRectangle;
import net.minecraft.client.gui.render.pip.PictureInPictureRenderer;
import net.minecraft.client.model.Model;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.renderer.BiomeColors;
import net.minecraft.client.renderer.Projection;
import net.minecraft.client.renderer.ProjectionMatrixBuffer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.block.BlockAndTintGetter;
import net.minecraft.client.renderer.block.FluidRenderer;
import net.minecraft.client.renderer.block.ModelBlockRenderer;
import net.minecraft.client.renderer.block.dispatch.BlockStateModel;
import net.minecraft.client.renderer.chunk.ChunkSectionLayer;
import net.minecraft.client.renderer.fog.FogData;
import net.minecraft.client.renderer.fog.FogRenderer;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.gui.pip.PictureInPictureRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.client.resources.model.geometry.BakedQuad;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Unit;
import net.minecraft.world.entity.player.PlayerModelType;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.level.CardinalLighting;
import net.minecraft.world.level.ColorResolver;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.LeavesBlock;
import net.minecraft.world.level.block.RenderShape;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.lighting.LevelLightEngine;
import net.minecraft.world.level.material.FluidState;
import org.joml.Matrix4f;
import org.joml.Vector4f;
import org.jspecify.annotations.Nullable;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Lobinin 3B sahnesi (26.x). Biyom dünyası oyunun kendi blok çizicisiyle (gerçek dokular, ortam
 * gölgesi, biyom renkleri, yüz ayıklama) bir kez ağa dönüştürülür ve önbellekte tutulur; her karede
 * yalnızca köşeler kameraya göre yeniden yazılır. Karakterler oyunun oyuncu modeliyle, gerçek skinle
 * aynı sahnede çizilir. Perspektif kamera ve gerçek sis kullanılır.
 */
public final class LobbyRender26 {
    private LobbyRender26() {}

    /** GUI'ye eklenen çizim isteği */
    public record State(LobbyFrame frame, int x0, int y0, int x1, int y1, float scale, @Nullable ScreenRectangle scissorArea, @Nullable ScreenRectangle bounds)
            implements PictureInPictureRenderState {
    }

    // ───────── Ağ (mesh) önbelleği ─────────

    /** Köşe başına 10 sayı: x y z renk u v nx ny nz sallanma */
    private static final int STRIDE = 10;
    private static final ChunkSectionLayer[] LAYERS = ChunkSectionLayer.values();

    static final class Mesh {
        final float[][] data = new float[LAYERS.length][];
        final int[] count = new int[LAYERS.length];
        final LobbyLight light;
        final LobbyBiome biome;

        Mesh(LobbyBiome biome, LobbyLight light) {
            this.biome = biome;
            this.light = light;
            for (int i = 0; i < LAYERS.length; i++) data[i] = new float[STRIDE * 4096];
        }

        void put(int layer, float x, float y, float z, int color, float u, float v, float nx, float ny, float nz, float sway) {
            float[] d = data[layer];
            int o = count[layer] * STRIDE;
            if (o + STRIDE > d.length) d = data[layer] = Arrays.copyOf(d, d.length * 2);
            d[o] = x;
            d[o + 1] = y;
            d[o + 2] = z;
            d[o + 3] = Float.intBitsToFloat(color);
            d[o + 4] = u;
            d[o + 5] = v;
            d[o + 6] = nx;
            d[o + 7] = ny;
            d[o + 8] = nz;
            d[o + 9] = sway;
            count[layer]++;
        }

        int vertices() {
            int n = 0;
            for (int c : count) n += c;
            return n;
        }
    }

    private static final Map<LobbyBiome, CompletableFuture<Mesh>> MESHES = new HashMap<>();
    static LobbyScene scene(LobbyBiome b) {
        return SceneGen.cached(b);
    }

    /** Ağ hazırsa döner; değilse arka planda hazırlamaya başlar ve null döner */
    static synchronized Mesh mesh(LobbyBiome b) {
        CompletableFuture<Mesh> f = MESHES.get(b);
        if (f == null) {
            LobbyScene s = scene(b);
            boolean ao = Minecraft.getInstance().options.ambientOcclusion().get();
            boolean cutoutLeaves = Minecraft.getInstance().options.cutoutLeaves().get();
            f = CompletableFuture.supplyAsync(() -> build(s, ao, cutoutLeaves));
            f.exceptionally(e -> {
                WestHud.LOG.error("Lobi sahnesi hazırlanamadı ({})", b.id, e);
                return null;
            });
            MESHES.put(b, f);
        }
        return f.isDone() && !f.isCompletedExceptionally() ? f.join() : null;
    }

    /** Kaynak paketi değişince (dokular yeniden yüklenince) ağlar yeniden kurulsun */
    public static synchronized void invalidate() {
        MESHES.clear();
    }

    // Blok durumu dizesi → BlockState ("minecraft:spruce_leaves[persistent=true]")
    private static final Map<String, BlockState> STATES = new HashMap<>();

    static synchronized BlockState state(String s) {
        return STATES.computeIfAbsent(s, LobbyRender26::parse);
    }

    private static BlockState parse(String s) {
        int b = s.indexOf('[');
        String id = b < 0 ? s : s.substring(0, b);
        Block block = BuiltInRegistries.BLOCK.getOptional(Identifier.parse(id)).orElse(null);
        if (block == null) {
            WestHud.LOG.warn("Lobi: bilinmeyen blok {}", id);
            return Blocks.AIR.defaultBlockState();
        }
        BlockState st = block.defaultBlockState();
        if (b >= 0) {
            for (String kv : s.substring(b + 1, s.length() - 1).split(",")) {
                String[] p = kv.split("=");
                if (p.length != 2) continue;
                Property<?> prop = block.getStateDefinition().getProperty(p[0]);
                if (prop != null) st = with(st, prop, p[1]);
            }
        }
        return st;
    }

    private static <T extends Comparable<T>> BlockState with(BlockState st, Property<T> prop, String value) {
        return prop.getValue(value).map(v -> st.setValue(prop, v)).orElse(st);
    }

    /** Sahneyi oyunun blok çizicisinin gördüğü dünya olarak sunar */
    static final class SceneLevel implements BlockAndTintGetter {
        final LobbyScene scene;
        final LobbyLight light;
        final BlockState[] palette;

        SceneLevel(LobbyScene scene, LobbyLight light, BlockState[] palette) {
            this.scene = scene;
            this.light = light;
            this.palette = palette;
        }

        @Override
        public BlockState getBlockState(BlockPos pos) {
            int x = pos.getX(), y = pos.getY(), z = pos.getZ();
            if (y < LobbyScene.MIN_Y) return Blocks.STONE.defaultBlockState();
            // Sahnenin kenarı dışarı doğru uzar: kenarda duvar yüzleri çizilmez
            if (x < LobbyScene.MIN_X || x > LobbyScene.MAX_X || z < LobbyScene.MIN_Z || z > LobbyScene.MAX_Z) {
                x = Math.max(LobbyScene.MIN_X, Math.min(LobbyScene.MAX_X, x));
                z = Math.max(LobbyScene.MIN_Z, Math.min(LobbyScene.MAX_Z, z));
            }
            return palette[scene.id(x, y, z)];
        }

        @Override
        public FluidState getFluidState(BlockPos pos) {
            return getBlockState(pos).getFluidState();
        }

        @Override
        public @Nullable BlockEntity getBlockEntity(BlockPos pos) {
            return null;
        }

        @Override
        public int getHeight() {
            return LobbyScene.SY;
        }

        @Override
        public int getMinY() {
            return LobbyScene.MIN_Y;
        }

        @Override
        public LevelLightEngine getLightEngine() {
            return LevelLightEngine.EMPTY;
        }

        @Override
        public int getBrightness(LightLayer layer, BlockPos pos) {
            return layer == LightLayer.SKY ? light.sky(pos.getX(), pos.getY(), pos.getZ()) : light.block(pos.getX(), pos.getY(), pos.getZ());
        }

        @Override
        public CardinalLighting cardinalLighting() {
            return scene.biome.netherShading() ? CardinalLighting.NETHER : CardinalLighting.DEFAULT;
        }

        @Override
        public int getBlockTint(BlockPos pos, ColorResolver color) {
            LobbyBiome b = scene.biome;
            if (color == BiomeColors.WATER_COLOR_RESOLVER) return 0xFF3F76E4;
            boolean grass = color == BiomeColors.GRASS_COLOR_RESOLVER;
            return switch (b) {
                case SNOWY -> grass ? 0xFF80B497 : 0xFF60A17B;
                case CHERRY -> grass ? 0xFF8DC15C : 0xFF6BA941;
                case BADLANDS -> grass ? 0xFF90814D : 0xFF9E814D;
                case DESERT -> grass ? 0xFFBFB755 : 0xFFAEA42A;
                default -> grass ? 0xFF8EB971 : 0xFF71A74D;
            };
        }
    }

    /** Işık değerlerini (0–1) biyoma göre renk çarpanına çevirir; böylece ışık haritasından bağımsız */
    static int shade(LobbyBiome b, float sky, float block) {
        float s = curve(sky * b.skyLight);
        float l = curve(block);
        float amb = 0.10f + (1 - b.skyLight) * 0.36f;
        float r = Math.max(amb, Math.max(s * (b == LobbyBiome.SNOWY ? 0.93f : 1f), l * 1.0f));
        float g = Math.max(amb * 0.95f, Math.max(s * (b == LobbyBiome.SNOWY ? 0.97f : 1f), l * 0.84f));
        float bl = Math.max(amb * (b == LobbyBiome.END ? 1.15f : 0.95f), Math.max(s, l * 0.66f));
        return 0xFF000000 | (c255(r) << 16) | (c255(g) << 8) | c255(bl);
    }

    private static int brighten(int c, float k) {
        return (c & 0xFF000000) | (Math.min(255, Math.round(((c >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k));
    }

    private static float curve(float v) {
        v = Math.max(0, Math.min(1, v));
        return v / (4f - 3f * v) * 0.82f + v * 0.18f;
    }

    private static int c255(float v) {
        return Math.max(0, Math.min(255, Math.round(v * 255)));
    }

    private static int mul(int a, int b) {
        int r = ((a >> 16) & 255) * ((b >> 16) & 255) / 255, g = ((a >> 8) & 255) * ((b >> 8) & 255) / 255, bl = (a & 255) * (b & 255) / 255;
        return (a & 0xFF000000) | (r << 16) | (g << 8) | bl;
    }

    private static Mesh build(LobbyScene s, boolean ao, boolean cutoutLeaves) {
        long t0 = System.nanoTime();
        Minecraft mc = Minecraft.getInstance();
        List<String> pal = s.palette();
        BlockState[] states = new BlockState[pal.size()];
        int[] emission = new int[pal.size()], damp = new int[pal.size()];
        for (int i = 0; i < states.length; i++) {
            states[i] = state(pal.get(i));
            emission[i] = states[i].getLightEmission();
            damp[i] = i == 0 ? 0 : states[i].getLightDampening();
        }
        LobbyLight light = LobbyLight.compute(s, emission, damp);
        SceneLevel level = new SceneLevel(s, light, states);
        Mesh mesh = new Mesh(s.biome, light);
        ModelBlockRenderer renderer = new ModelBlockRenderer(ao, true, mc.getBlockColors());
        FluidRenderer fluids = new FluidRenderer(mc.getModelManager().getFluidStateModelSet());
        var models = mc.getModelManager().getBlockStateModelSet();
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        int[] cur = new int[4];
        // Blok dörtgenleri
        for (int x = LobbyScene.MIN_X; x <= LobbyScene.MAX_X; x++)
            for (int z = LobbyScene.MIN_Z; z <= LobbyScene.MAX_Z; z++)
                for (int y = LobbyScene.MIN_Y; y <= LobbyScene.MAX_Y; y++) {
                    int id = s.id(x, y, z);
                    if (id == 0) continue;
                    BlockState st = states[id];
                    pos.set(x, y, z);
                    FluidState fs = st.getFluidState();
                    if (!fs.isEmpty()) {
                        cur[0] = x;
                        cur[1] = y;
                        cur[2] = z;
                        fluids.tesselate(level, pos.immutable(), layer -> new Recorder(mesh, layer.ordinal(), s.biome, cur), st, fs);
                    }
                    if (st.getRenderShape() != RenderShape.MODEL) continue;
                    BlockStateModel model = models.get(st);
                    boolean leaves = st.getBlock() instanceof LeavesBlock;
                    boolean plant = !st.isSolidRender() && !leaves && st.getCollisionShape(level, pos).isEmpty();
                    float sway = leaves ? 1 : plant ? 2 : 0;
                    boolean opaque = ModelBlockRenderer.forceOpaque(cutoutLeaves, st);
                    final int bx = x, by = y, bz = z;
                    renderer.tesselateBlock((qx, qy, qz, quad, inst) -> addQuad(mesh, s.biome, quad, inst, qx, qy, qz, opaque ? 0 : quad.materialInfo().layer().ordinal(), sway, by),
                            x, y, z, level, pos.immutable(), st, model, st.getSeed(pos));
                }
        WestHud.LOG.info("Lobi sahnesi hazır: {} ({} köşe, {} ms)", s.biome.id, mesh.vertices(), (System.nanoTime() - t0) / 1_000_000);
        return mesh;
    }

    private static void addQuad(Mesh m, LobbyBiome b, BakedQuad quad, QuadInstance inst, float x, float y, float z, int layer, float sway, int blockY) {
        var n = quad.direction().getUnitVec3f();
        int emission = quad.materialInfo().lightEmission();
        for (int v = 0; v < 4; v++) {
            var p = quad.position(v);
            long uv = quad.packedUV(v);
            int lc = inst.getLightCoordsWithEmission(v, emission);
            float sky = ((lc >> 16) & 0xFF) / 240f, blk = (lc & 0xFF) / 240f;
            int color = mul(inst.getColor(v), shade(b, sky, blk));
            // Bitkilerde yalnızca üst köşeler sallanır
            float sw = sway == 2 ? (p.y() > 0.4f ? 2 : 0) : sway;
            m.put(layer, x + p.x(), y + p.y(), z + p.z(), color, net.minecraft.client.model.geom.builders.UVPair.unpackU(uv), net.minecraft.client.model.geom.builders.UVPair.unpackV(uv), n.x(), n.y(), n.z(), sw);
        }
    }

    /** Sıvı (su, lav) köşelerini yakalar; sıvı çizici konumu 16'lık bölüm içinde verir */
    static final class Recorder implements VertexConsumer {
        final Mesh mesh;
        final int layer;
        final LobbyBiome biome;
        final int[] pos;

        Recorder(Mesh mesh, int layer, LobbyBiome biome, int[] pos) {
            this.mesh = mesh;
            this.layer = layer;
            this.biome = biome;
            this.pos = pos;
        }

        @Override
        public void addVertex(float x, float y, float z, int color, float u, float v, int overlay, int light, float nx, float ny, float nz) {
            float ox = pos[0] - (pos[0] & 15), oy = pos[1] - (pos[1] & 15), oz = pos[2] - (pos[2] & 15);
            float sky = ((light >> 16) & 0xFF) / 240f, blk = (light & 0xFF) / 240f;
            mesh.put(layer, x + ox, y + oy, z + oz, mul(color, shade(biome, sky, blk)), u, v, nx, ny, nz, 0);
        }

        // Zincirleme yazım (sıvı çizici böyle yazar): addVertex → setColor → setUv → setLight → setNormal
        private boolean pend;
        private float px, py, pz, pu, pv;
        private int pc = 0xFFFFFFFF, pl = 0xF000F0;

        private void flush(float nx, float ny, float nz) {
            if (!pend) return;
            pend = false;
            addVertex(px, py, pz, pc, pu, pv, 0, pl, nx, ny, nz);
        }

        @Override public VertexConsumer addVertex(float x, float y, float z) { flush(0, 1, 0); pend = true; px = x; py = y; pz = z; pc = 0xFFFFFFFF; pl = 0xF000F0; return this; }
        @Override public VertexConsumer setColor(int r, int g, int b, int a) { pc = (a << 24) | (r << 16) | (g << 8) | b; return this; }
        @Override public VertexConsumer setColor(int c) { pc = c; return this; }
        @Override public VertexConsumer setUv(float u, float v) { pu = u; pv = v; return this; }
        @Override public VertexConsumer setUv1(int u, int v) { return this; }
        @Override public VertexConsumer setUv2(int u, int v) { pl = (v << 16) | (u & 0xFFFF); return this; }
        @Override public VertexConsumer setNormal(float x, float y, float z) { flush(x, y, z); return this; }
        @Override public VertexConsumer setLineWidth(float w) { return this; }
    }

    /** Son karede lobi çizildi mi (oyuna girilince temizlik için) */
    static volatile long lastUsed;
    static Renderer INSTANCE;

    /**
     * Lobi kapandı (bir dünyaya ya da sunucuya girildi): biyom ağları, sahneler ve tam ekran sahne
     * dokusu bellekten bırakılır; oyun içinde lobi hiçbir iş yapmaz.
     */
    public static void releaseIfIdle(boolean inWorld) {
        if (!inWorld || lastUsed == 0) return;
        lastUsed = 0;
        synchronized (LobbyRender26.class) {
            MESHES.clear();
            STATES.clear();
        }
        SceneGen.clearCache();
        if (INSTANCE != null) INSTANCE.release();
        WestHud.LOG.info("Lobi kapandı: sahne bellekten bırakıldı");
    }

    // ───────── Çizici ─────────

    public static final class Renderer extends PictureInPictureRenderer<State> {
        private final Projection projection = new Projection();
        private final ProjectionMatrixBuffer projectionBuffer = new ProjectionMatrixBuffer("West lobby");
        private FogRenderer fog;
        private Model.Simple wide, slim;

        public Renderer() {
            INSTANCE = this;
        }

        @Override
        public Class<State> getRenderStateClass() {
            return State.class;
        }

        @Override
        protected String getTextureLabel() {
            return "west lobby";
        }

        @Override
        protected void renderToTexture(State st, PoseStack pose, SubmitNodeCollector out) {
            LobbyFrame f = st.frame();
            Minecraft mc = Minecraft.getInstance();
            lastUsed = System.currentTimeMillis();
            int gs = Math.max(1, mc.getWindow().getGuiScale());
            float w = (st.x1() - st.x0()) * gs, h = (st.y1() - st.y0()) * gs;
            var cam = f.camera;
            // Perspektif kamera (oyunun kendi ters-z projeksiyonuyla)
            projection.setupPerspective(0.05f, 400f, cam.fov, w, h);
            RenderSystem.setProjectionMatrix(projectionBuffer.getBuffer(projection), ProjectionType.PERSPECTIVE);
            // Görüş: yalnızca dönüş; konumlar kameraya göre (oyundaki gibi) yazılır, sis mesafesi doğru olur
            Matrix4f rot = new Matrix4f().lookAt(0, 0, 0, cam.target.x - cam.eye.x, cam.target.y - cam.eye.y, cam.target.z - cam.eye.z, 0, 1, 0);
            var mv = RenderSystem.getModelViewStack();
            mv.identity();
            mv.mul(rot);
            pose.setIdentity();

            LobbyBiome biome = f.scene.biome;
            setupFog(biome);
            float ex = cam.eye.x, ey = cam.eye.y, ez = cam.eye.z;
            Mesh mesh = f.light ? null : mesh(biome);
            if (mesh != null) {
                float t = f.time;
                for (int li = 0; li < LAYERS.length; li++) {
                    int n = mesh.count[li];
                    if (n == 0) continue;
                    final float[] d = mesh.data[li];
                    RenderType type = switch (LAYERS[li]) {
                        case SOLID -> RenderTypes.solidMovingBlock();
                        case CUTOUT -> RenderTypes.cutoutMovingBlock();
                        case TRANSLUCENT -> RenderTypes.translucentMovingBlock();
                    };
                    out.submitCustomGeometry(pose, type, (p, buf) -> {
                        for (int i = 0, o = 0; i < n; i++, o += STRIDE) {
                            float x = d[o], y = d[o + 1], z = d[o + 2];
                            float sw = d[o + 9];
                            if (sw > 0) {
                                float k = sw == 1 ? 0.028f : 0.06f;
                                float ph = (x + z) * 0.55f + y * 0.3f;
                                x += (float) Math.sin(t * 1.7f + ph) * k;
                                z += (float) Math.cos(t * 1.3f + ph * 1.3f) * k * 0.7f;
                            }
                            buf.addVertex(x - ex, y - ey, z - ez, Float.floatToRawIntBits(d[o + 3]), d[o + 4], d[o + 5], OverlayTexture.NO_OVERLAY, 0xF000F0, d[o + 6], d[o + 7], d[o + 8]);
                        }
                    });
                }
            }
            // Karakterlerin altında yumuşak gölge
            out.submitCustomGeometry(pose, RenderTypes.entityShadow(SHADOW), (p, buf) -> shadows(buf, f, ex, ey, ez));
            // Karakterler
            mc.gameRenderer.lighting().setupFor(Lighting.Entry.LEVEL);
            for (LobbyFrame.Avatar a : f.avatars) {
                if (a.alpha <= 0.02f) continue;
                PlayerSkin skin = Skins26.skin(a);
                Model.Simple model = model(skin.model() == PlayerModelType.SLIM);
                animate(model, f.time + a.phase, a);
                int tint = 0xFFFFFFFF;
                if (mesh != null) {
                    int bx = (int) Math.floor(a.x), by = (int) Math.floor(a.y + 1), bz = (int) Math.floor(a.z);
                    tint = shade(biome, mesh.light.sky(bx, by, bz) / 15f, mesh.light.block(bx, by, bz) / 15f);
                    // Karakterler karanlık biyomlarda da seçilebilsin
                    tint = brighten(tint, Math.max(1.15f, 0.62f * 255f / Math.max(1, Math.max((tint >> 16) & 255, Math.max((tint >> 8) & 255, tint & 255)))));
                }
                int alpha = Math.round(Math.max(0, Math.min(1, a.alpha)) * 255);
                tint = (alpha << 24) | (tint & 0xFFFFFF);
                pose.pushPose();
                pose.translate(a.x - ex, a.y - ey, a.z - ez);
                pose.mulPose(Axis.YP.rotationDegrees(180f - a.yaw));
                pose.scale(-1, -1, 1);
                pose.scale(0.9375f, 0.9375f, 0.9375f);
                pose.translate(0, -1.501f, 0);
                out.submitModel(model, Unit.INSTANCE, pose, RenderTypes.entityTranslucent(skin.body().texturePath()), 0xF000F0, OverlayTexture.NO_OVERLAY, tint, null, 0, null);
                // Kendi karakterinde West Coin ile alınan aksesuarlar (pelerin, şapka, sırt)
                if (a.self && a.alpha > 0.9f) {
                    final PoseStack ps = pose;
                    WestHud.safe("lobby-cosmetics", () -> WestCosmetics.renderGui(model.root(), ps,
                            (part, type) -> out.submitModelPart(part, ps, type, 0xF000F0, OverlayTexture.NO_OVERLAY, null)));
                }
                pose.popPose();
            }
        }

        private static final Identifier SHADOW = Identifier.withDefaultNamespace("textures/misc/shadow.png");

        private static void shadows(VertexConsumer buf, LobbyFrame f, float ex, float ey, float ez) {
            for (LobbyFrame.Avatar a : f.avatars) {
                if (a.alpha <= 0.05f) continue;
                float r = 0.72f, y = a.y + 0.012f - ey;
                float x0 = a.x - r - ex, x1 = a.x + r - ex, z0 = a.z - r - ez, z1 = a.z + r - ez;
                int col = (Math.round(Math.min(1, a.alpha) * 125) << 24) | 0xFFFFFF;
                buf.addVertex(x0, y, z0, col, 0, 0, OverlayTexture.NO_OVERLAY, 0xF000F0, 0, 1, 0);
                buf.addVertex(x0, y, z1, col, 0, 1, OverlayTexture.NO_OVERLAY, 0xF000F0, 0, 1, 0);
                buf.addVertex(x1, y, z1, col, 1, 1, OverlayTexture.NO_OVERLAY, 0xF000F0, 0, 1, 0);
                buf.addVertex(x1, y, z0, col, 1, 0, OverlayTexture.NO_OVERLAY, 0xF000F0, 0, 1, 0);
            }
        }

        private void setupFog(LobbyBiome b) {
            if (fog == null) {
                GpuBufferSlice prev = RenderSystem.getShaderFog();
                fog = new FogRenderer();
                if (prev != null) RenderSystem.setShaderFog(prev);
            }
            FogData d = new FogData();
            int c = b.fog;
            d.color = new Vector4f(((c >> 16) & 255) / 255f, ((c >> 8) & 255) / 255f, (c & 255) / 255f, 1f);
            d.environmentalStart = b.fogStart;
            d.environmentalEnd = b.fogEnd;
            d.renderDistanceStart = b.fogEnd;
            d.renderDistanceEnd = b.fogEnd + 40;
            d.skyEnd = b.fogEnd;
            d.cloudEnd = b.fogEnd;
            fog.endFrame();
            fog.updateBuffer(d);
            RenderSystem.setShaderFog(fog.getBuffer(FogRenderer.FogMode.WORLD));
        }

        private Model.Simple model(boolean slimArms) {
            Minecraft mc = Minecraft.getInstance();
            if (wide == null) {
                wide = new Model.Simple(mc.getEntityModels().bakeLayer(ModelLayers.PLAYER), RenderTypes::entityTranslucent);
                slim = new Model.Simple(mc.getEntityModels().bakeLayer(ModelLayers.PLAYER_SLIM), RenderTypes::entityTranslucent);
            }
            return slimArms ? slim : wide;
        }

        /** Hafif bekleme animasyonu: nefes, kollar, baş */
        private static void animate(Model.Simple m, float t, LobbyFrame.Avatar a) {
            m.resetPose();
            ModelPart root = m.root();
            ModelPart head = root.getChild("head"), right = root.getChild("right_arm"), left = root.getChild("left_arm"), body = root.getChild("body");
            float breathe = (float) Math.sin(t * 1.3f);
            head.yRot = (float) Math.sin(t * 0.37f) * 0.22f;
            head.xRot = (float) Math.sin(t * 0.29f + 1) * 0.06f - 0.04f;
            // Ortadaki karakter fareye bakar
            if (!Float.isNaN(a.lookYaw)) {
                head.yRot = a.lookYaw;
                head.xRot = a.lookPitch;
            }
            right.zRot = 0.06f + breathe * 0.04f;
            left.zRot = -0.06f - breathe * 0.04f;
            right.xRot = (float) Math.sin(t * 0.6f) * 0.05f;
            left.xRot = -(float) Math.sin(t * 0.6f) * 0.05f;
            body.y += breathe * 0.12f;
            head.y += breathe * 0.12f;
            right.y += breathe * 0.12f;
            left.y += breathe * 0.12f;
        }

        /** Sahne dokusunu bırak (lobi kapandı); lobi yeniden açılınca prepare() yenisini oluşturur */
        void release() {
            var a = (dev.west.companion.v26.mixin.PipTextureAccessor) (Object) this;
            if (a.west$texture() == null) return;
            a.west$textureView().close();
            a.west$texture().close();
            a.west$depthTextureView().close();
            a.west$depthTexture().close();
            a.west$setTextureView(null);
            a.west$setTexture(null);
            a.west$setDepthTextureView(null);
            a.west$setDepthTexture(null);
        }

        @Override
        public void close() {
            super.close();
            projectionBuffer.close();
            if (fog != null) fog.close();
        }
    }
}
