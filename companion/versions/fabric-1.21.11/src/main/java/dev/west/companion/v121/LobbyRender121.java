package dev.west.companion.v121;

import com.mojang.blaze3d.ProjectionType;
import com.mojang.blaze3d.buffers.GpuBuffer;
import com.mojang.blaze3d.buffers.GpuBufferSlice;
import com.mojang.blaze3d.buffers.Std140Builder;
import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
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
import net.minecraft.client.gui.render.state.pip.PictureInPictureRenderState;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.renderer.BiomeColors;
import net.minecraft.client.renderer.CachedPerspectiveProjectionMatrixBuffer;
import net.minecraft.client.renderer.ItemBlockRenderTypes;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.chunk.ChunkSectionLayer;
import net.minecraft.client.renderer.fog.FogRenderer;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.player.PlayerModelType;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.level.BlockAndTintGetter;
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
import org.jspecify.annotations.Nullable;
import org.lwjgl.system.MemoryStack;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Lobinin 3B sahnesi (1.21.11). 26.x adaptörüyle aynı yaklaşım: biyom dünyası oyunun kendi blok
 * çizicisiyle bir kez ağa dönüştürülüp önbelleğe alınır; her karede kameraya göre yeniden yazılır.
 */
public final class LobbyRender121 {
    private LobbyRender121() {}

    public record State(LobbyFrame frame, int x0, int y0, int x1, int y1, float scale, @Nullable ScreenRectangle scissorArea, @Nullable ScreenRectangle bounds)
            implements PictureInPictureRenderState {
    }

    private static final int STRIDE = 10;
    private static final int LAYERS = 3;

    static final class Mesh {
        final float[][] data = new float[LAYERS][];
        final int[] count = new int[LAYERS];
        final LobbyLight light;

        Mesh(LobbyLight light) {
            this.light = light;
            for (int i = 0; i < LAYERS; i++) data[i] = new float[STRIDE * 4096];
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
            return count[0] + count[1] + count[2];
        }
    }

    private static final Map<LobbyBiome, CompletableFuture<Mesh>> MESHES = new HashMap<>();

    static synchronized Mesh mesh(LobbyBiome b) {
        CompletableFuture<Mesh> f = MESHES.get(b);
        if (f == null) {
            LobbyScene s = SceneGen.cached(b);
            f = CompletableFuture.supplyAsync(() -> build(s));
            f.exceptionally(e -> {
                WestHud.LOG.error("Lobi sahnesi hazırlanamadı ({})", b.id, e);
                return null;
            });
            MESHES.put(b, f);
        }
        return f.isDone() && !f.isCompletedExceptionally() ? f.join() : null;
    }

    private static final Map<String, BlockState> STATES = new HashMap<>();

    static synchronized BlockState state(String s) {
        return STATES.computeIfAbsent(s, LobbyRender121::parse);
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
            x = Math.max(LobbyScene.MIN_X, Math.min(LobbyScene.MAX_X, x));
            z = Math.max(LobbyScene.MIN_Z, Math.min(LobbyScene.MAX_Z, z));
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
        public float getShade(Direction d, boolean shade) {
            boolean nether = scene.biome.netherShading();
            if (!shade) return nether ? 0.9f : 1f;
            return switch (d) {
                case DOWN -> nether ? 0.9f : 0.5f;
                case UP -> nether ? 0.9f : 1f;
                case NORTH, SOUTH -> 0.8f;
                default -> 0.6f;
            };
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

    // Işık → renk çarpanı (26.x ile aynı eğri)
    static int shade(LobbyBiome b, float sky, float block) {
        float s = curve(sky * b.skyLight);
        float l = curve(block);
        float amb = 0.10f + (1 - b.skyLight) * 0.36f;
        float r = Math.max(amb, Math.max(s * (b == LobbyBiome.SNOWY ? 0.93f : 1f), l));
        float g = Math.max(amb * 0.95f, Math.max(s * (b == LobbyBiome.SNOWY ? 0.97f : 1f), l * 0.84f));
        float bl = Math.max(amb * (b == LobbyBiome.END ? 1.15f : 0.95f), Math.max(s, l * 0.66f));
        return 0xFF000000 | (c255(r) << 16) | (c255(g) << 8) | c255(bl);
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

    private static int brighten(int c, float k) {
        return (c & 0xFF000000) | (Math.min(255, Math.round(((c >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k));
    }

    private static int layerOf(ChunkSectionLayer l) {
        return l == ChunkSectionLayer.SOLID ? 0 : l == ChunkSectionLayer.CUTOUT ? 1 : 2;
    }

    /** Blok çizicisinin yazdığı köşeleri yakalar (sahne koordinatında) */
    static final class Recorder implements VertexConsumer {
        final Mesh mesh;
        final LobbyBiome biome;
        int layer;
        float sway, ox, oy, oz;

        Recorder(Mesh mesh, LobbyBiome biome) {
            this.mesh = mesh;
            this.biome = biome;
        }

        @Override
        public void addVertex(float x, float y, float z, int color, float u, float v, int overlay, int light, float nx, float ny, float nz) {
            float sky = ((light >> 16) & 0xFF) / 240f, blk = (light & 0xFF) / 240f;
            mesh.put(layer, x + ox, y + oy, z + oz, mul(color, shade(biome, sky, blk)), u, v, nx, ny, nz, 0);
        }

        @Override public VertexConsumer addVertex(float x, float y, float z) { return this; }
        @Override public VertexConsumer setColor(int r, int g, int b, int a) { return this; }
        @Override public VertexConsumer setColor(int c) { return this; }
        @Override public VertexConsumer setUv(float u, float v) { return this; }
        @Override public VertexConsumer setUv1(int u, int v) { return this; }
        @Override public VertexConsumer setUv2(int u, int v) { return this; }
        @Override public VertexConsumer setNormal(float x, float y, float z) { return this; }
        @Override public VertexConsumer setLineWidth(float w) { return this; }
    }

    private static Mesh build(LobbyScene s) {
        long t0 = System.nanoTime();
        Minecraft mc = Minecraft.getInstance();
        List<String> pal = s.palette();
        BlockState[] states = new BlockState[pal.size()];
        int[] emission = new int[pal.size()], damp = new int[pal.size()];
        for (int i = 0; i < states.length; i++) {
            states[i] = state(pal.get(i));
            emission[i] = states[i].getLightEmission();
            damp[i] = i == 0 ? 0 : states[i].getLightBlock();
        }
        LobbyLight light = LobbyLight.compute(s, emission, damp);
        SceneLevel level = new SceneLevel(s, light, states);
        Mesh mesh = new Mesh(light);
        Recorder rec = new Recorder(mesh, s.biome);
        var dispatcher = mc.getBlockRenderer();
        RandomSource random = RandomSource.create();
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        PoseStack ps = new PoseStack();
        for (int x = LobbyScene.MIN_X; x <= LobbyScene.MAX_X; x++)
            for (int z = LobbyScene.MIN_Z; z <= LobbyScene.MAX_Z; z++)
                for (int y = LobbyScene.MIN_Y; y <= LobbyScene.MAX_Y; y++) {
                    int id = s.id(x, y, z);
                    if (id == 0) continue;
                    BlockState st = states[id];
                    pos.set(x, y, z);
                    FluidState fs = st.getFluidState();
                    if (!fs.isEmpty()) {
                        rec.layer = layerOf(ItemBlockRenderTypes.getRenderLayer(fs));
                        rec.sway = 0;
                        // Sıvı çizici konumu 16'lık bölüm içinde verir
                        rec.ox = x - (x & 15);
                        rec.oy = y - (y & 15);
                        rec.oz = z - (z & 15);
                        dispatcher.renderLiquid(pos.immutable(), level, rec, st, fs);
                    }
                    if (st.getRenderShape() != RenderShape.MODEL) continue;
                    boolean leaves = st.getBlock() instanceof LeavesBlock;
                    boolean plant = !st.isSolidRender() && !leaves && st.getCollisionShape(level, pos).isEmpty();
                    rec.sway = leaves ? 1 : plant ? 2 : 0;
                    rec.layer = layerOf(ItemBlockRenderTypes.getChunkRenderType(st));
                    rec.ox = rec.oy = rec.oz = 0;
                    random.setSeed(st.getSeed(pos));
                    var parts = dispatcher.getBlockModel(st).collectParts(random);
                    ps.pushPose();
                    ps.translate(x, y, z);
                    dispatcher.renderBatched(st, pos.immutable(), level, ps, new Shifted(rec, y), true, parts);
                    ps.popPose();
                }
        WestHud.LOG.info("Lobi sahnesi hazır: {} ({} köşe, {} ms)", s.biome.id, mesh.vertices(), (System.nanoTime() - t0) / 1_000_000);
        return mesh;
    }

    /** Bitki sallanması için köşenin blok tabanına göre yüksekliğini bilen ince sarmalayıcı */
    static final class Shifted implements VertexConsumer {
        final Recorder r;
        final int baseY;

        Shifted(Recorder r, int baseY) {
            this.r = r;
            this.baseY = baseY;
        }

        @Override
        public void addVertex(float x, float y, float z, int color, float u, float v, int overlay, int light, float nx, float ny, float nz) {
            float sky = ((light >> 16) & 0xFF) / 240f, blk = (light & 0xFF) / 240f;
            float sw = r.sway == 2 ? ((y - baseY) > 0.4f ? 2 : 0) : r.sway;
            r.mesh.put(r.layer, x, y, z, mul(color, shade(r.biome, sky, blk)), u, v, nx, ny, nz, sw);
        }

        @Override public VertexConsumer addVertex(float x, float y, float z) { return this; }
        @Override public VertexConsumer setColor(int rr, int g, int b, int a) { return this; }
        @Override public VertexConsumer setColor(int c) { return this; }
        @Override public VertexConsumer setUv(float u, float v) { return this; }
        @Override public VertexConsumer setUv1(int u, int v) { return this; }
        @Override public VertexConsumer setUv2(int u, int v) { return this; }
        @Override public VertexConsumer setNormal(float x, float y, float z) { return this; }
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
        synchronized (LobbyRender121.class) {
            MESHES.clear();
            STATES.clear();
        }
        SceneGen.clearCache();
        if (INSTANCE != null) INSTANCE.release();
        WestHud.LOG.info("Lobi kapandı: sahne bellekten bırakıldı");
    }

    // ───────── Çizici ─────────

    public static final class Renderer extends PictureInPictureRenderer<State> {
        private final CachedPerspectiveProjectionMatrixBuffer projection = new CachedPerspectiveProjectionMatrixBuffer("West lobby", 0.05f, 400f);
        private GpuBuffer fogBuffer;
        private PlayerModel wide, slim;

        public Renderer(MultiBufferSource.BufferSource buffers) {
            super(buffers);
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
        protected void renderToTexture(State st, PoseStack pose) {
            LobbyFrame f = st.frame();
            Minecraft mc = Minecraft.getInstance();
            lastUsed = System.currentTimeMillis();
            int gs = Math.max(1, mc.getWindow().getGuiScale());
            int w = (st.x1() - st.x0()) * gs, h = (st.y1() - st.y0()) * gs;
            var cam = f.camera;
            RenderSystem.setProjectionMatrix(projection.getBuffer(w, h, cam.fov), ProjectionType.PERSPECTIVE);
            var mv = RenderSystem.getModelViewStack();
            mv.pushMatrix();
            mv.identity();
            mv.mul(new Matrix4f().lookAt(0, 0, 0, cam.target.x - cam.eye.x, cam.target.y - cam.eye.y, cam.target.z - cam.eye.z, 0, 1, 0));
            pose.setIdentity();
            GpuBufferSlice prevFog = RenderSystem.getShaderFog();
            LobbyBiome biome = f.scene.biome;
            RenderSystem.setShaderFog(fog(biome));
            float ex = cam.eye.x, ey = cam.eye.y, ez = cam.eye.z;
            Mesh mesh = f.light ? null : mesh(biome);
            if (mesh != null) {
                float t = f.time;
                for (int li = 0; li < LAYERS; li++) {
                    int n = mesh.count[li];
                    if (n == 0) continue;
                    float[] d = mesh.data[li];
                    RenderType type = li == 0 ? RenderTypes.solidMovingBlock() : li == 1 ? RenderTypes.cutoutMovingBlock() : RenderTypes.translucentMovingBlock();
                    VertexConsumer buf = bufferSource.getBuffer(type);
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
                    bufferSource.endBatch(type);
                }
            }
            mc.gameRenderer.getLighting().setupFor(Lighting.Entry.LEVEL);
            for (LobbyFrame.Avatar a : f.avatars) {
                if (a.alpha <= 0.02f) continue;
                PlayerSkin skin = Skins121.skin(a);
                PlayerModel model = model(skin.model() == PlayerModelType.SLIM);
                animate(model, f.time + a.phase);
                int tint = 0xFFFFFFFF;
                if (mesh != null) {
                    int bx = (int) Math.floor(a.x), by = (int) Math.floor(a.y + 1), bz = (int) Math.floor(a.z);
                    tint = shade(biome, mesh.light.sky(bx, by, bz) / 15f, mesh.light.block(bx, by, bz) / 15f);
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
                RenderType type = RenderTypes.entityTranslucent(skin.body().texturePath());
                model.renderToBuffer(pose, bufferSource.getBuffer(type), 0xF000F0, OverlayTexture.NO_OVERLAY, tint);
                // Kendi karakterinde West Coin ile alınan aksesuarlar (pelerin, şapka, sırt)
                if (a.self && a.alpha > 0.9f) {
                    final PoseStack ps = pose;
                    WestHud.safe("lobby-cosmetics", () -> WestCosmetics.renderGui(model.root(), ps,
                            (part, rt) -> part.render(ps, bufferSource.getBuffer(rt), 0xF000F0, OverlayTexture.NO_OVERLAY)));
                }
                pose.popPose();
            }
            bufferSource.endBatch();
            RenderSystem.setShaderFog(prevFog);
            mv.popMatrix();
        }

        private GpuBufferSlice fog(LobbyBiome b) {
            int size = FogRenderer.FOG_UBO_SIZE;
            if (fogBuffer == null) fogBuffer = RenderSystem.getDevice().createBuffer(() -> "West lobby fog", 136, size);
            int c = b.fog;
            try (MemoryStack stack = MemoryStack.stackPush()) {
                var bytes = Std140Builder.onStack(stack, size)
                        .putVec4(((c >> 16) & 255) / 255f, ((c >> 8) & 255) / 255f, (c & 255) / 255f, 1f)
                        .putFloat(b.fogStart).putFloat(b.fogEnd)
                        .putFloat(b.fogEnd).putFloat(b.fogEnd + 40)
                        .putFloat(b.fogEnd).putFloat(b.fogEnd).get();
                RenderSystem.getDevice().createCommandEncoder().writeToBuffer(fogBuffer.slice(), bytes);
            }
            return fogBuffer.slice(0, size);
        }

        private PlayerModel model(boolean slimArms) {
            Minecraft mc = Minecraft.getInstance();
            if (wide == null) {
                wide = new PlayerModel(mc.getEntityModels().bakeLayer(ModelLayers.PLAYER), false);
                slim = new PlayerModel(mc.getEntityModels().bakeLayer(ModelLayers.PLAYER_SLIM), true);
            }
            return slimArms ? slim : wide;
        }

        private static void animate(PlayerModel m, float t) {
            m.resetPose();
            ModelPart root = m.root();
            ModelPart head = root.getChild("head"), right = root.getChild("right_arm"), left = root.getChild("left_arm"), body = root.getChild("body");
            float breathe = (float) Math.sin(t * 1.3f);
            head.yRot = (float) Math.sin(t * 0.37f) * 0.22f;
            head.xRot = (float) Math.sin(t * 0.29f + 1) * 0.06f - 0.04f;
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
            var a = (dev.west.companion.v121.mixin.PipTextureAccessor) (Object) this;
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
            projection.close();
            if (fogBuffer != null) fogBuffer.close();
        }
    }
}
