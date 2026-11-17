package dev.west.companion.v26;

import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import dev.west.hud.WestHud;
import dev.west.hud.cosmetic.Cosmetics;
import net.fabricmc.fabric.api.client.rendering.v1.LivingEntityRenderLayerRegistrationCallback;
import net.minecraft.client.Minecraft;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.RenderLayerParent;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.client.renderer.entity.player.AvatarRenderer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.core.ClientAsset;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.PlayerSkin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * West Coin kozmetikleri (26.2): pelerin, şapka, sırt ve aura. Yalnızca kendi oyuncunda görünür
 * (üçüncü şahıs, envanter); diğer oyuncular göremez.
 */
public final class WestCosmetics {
    private WestCosmetics() {}

    private static final int FULL_BRIGHT = 0xF000F0;
    private static final Map<String, Baked> MODELS = new HashMap<>();
    private static final Map<String, Identifier> CAPES = new HashMap<>();

    private record BakedPart(Cosmetics.Part def, ModelPart part) {}

    private record Baked(Cosmetics.Model def, List<BakedPart> parts, Identifier texture) {}

    static String equipped(String slot) {
        var c = WestHud.config == null ? null : WestHud.config.data.cosmetics;
        return c == null ? null : c.get(slot);
    }

    private static Identifier upload(String path, int w, int h, int[] argb) {
        Identifier id = Identifier.fromNamespaceAndPath("west_companion", path);
        var img = new NativeImage(w, h, false);
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) img.setPixel(x, y, argb[y * w + x]);
        Minecraft.getInstance().getTextureManager().register(id, new DynamicTexture(() -> "west " + path, img));
        return id;
    }

    private static Baked baked(String id) {
        if (id == null) return null;
        if (MODELS.containsKey(id)) return MODELS.get(id);
        Cosmetics.Model m = Cosmetics.model(id);
        Baked b = null;
        if (m != null) {
            List<BakedPart> parts = new ArrayList<>();
            for (Cosmetics.Part p : m.parts()) {
                MeshDefinition mesh = new MeshDefinition();
                PartDefinition root = mesh.getRoot();
                int i = 0;
                for (Cosmetics.Box x : p.boxes()) {
                    root.addOrReplaceChild("b" + i++, CubeListBuilder.create().texOffs(0, x.color() * 32).addBox(x.x(), x.y(), x.z(), x.w(), x.h(), x.d()), PartPose.ZERO);
                }
                parts.add(new BakedPart(p, LayerDefinition.create(mesh, 64, 256).bakeRoot()));
            }
            b = new Baked(m, parts, upload("cosmetic/" + id, 64, 256, Cosmetics.atlas(m)));
        }
        MODELS.put(id, b);
        return b;
    }

    /** Kuşanılmış pelerinin dokusu (yoksa null) */
    public static ClientAsset.Texture capeTexture() {
        String id = equipped("cape");
        if (id == null) return null;
        Identifier tex = CAPES.computeIfAbsent(id, k -> {
            int[] px = Cosmetics.cape(k);
            return px == null ? null : upload("cosmetic/" + k, 64, 32, px);
        });
        return tex == null ? null : new ClientAsset.ResourceTexture(tex, tex);
    }

    /** Oyuncunun skin'ine kuşanılmış pelerini ekle (yalnızca kendi oyuncun için çağrılır) */
    public static PlayerSkin withCape(PlayerSkin skin) {
        ClientAsset.Texture cape = capeTexture();
        if (cape == null) return skin;
        return new PlayerSkin(skin.body(), cape, skin.elytra(), skin.model(), skin.secure());
    }

    public static void register() {
        LivingEntityRenderLayerRegistrationCallback.EVENT.register((type, renderer, helper, ctx) -> {
            if (renderer instanceof AvatarRenderer<?> r) {
                @SuppressWarnings("unchecked")
                var parent = (RenderLayerParent<AvatarRenderState, PlayerModel>) (Object) r;
                helper.register(new Layer(parent));
            }
        });
    }

    /** Şapka ve sırt kozmetiklerini çizen katman */
    static final class Layer extends RenderLayer<AvatarRenderState, PlayerModel> {
        Layer(RenderLayerParent<AvatarRenderState, PlayerModel> parent) {
            super(parent);
        }

        @Override
        public void submit(PoseStack pose, SubmitNodeCollector out, int light, AvatarRenderState s, float yRot, float xRot) {
            var mc = Minecraft.getInstance();
            if (mc.player == null || s.id != mc.player.getId() || s.isInvisible) return;
            draw(pose, out, light, s, baked(equipped("hat")));
            draw(pose, out, light, s, baked(equipped("back")));
        }

        private void draw(PoseStack pose, SubmitNodeCollector out, int light, AvatarRenderState s, Baked b) {
            if (b == null) return;
            PlayerModel model = getParentModel();
            var type = RenderTypes.entityCutout(b.texture());
            int lit = b.def().glow() ? FULL_BRIGHT : light;
            for (BakedPart bp : b.parts()) {
                Cosmetics.Part p = bp.def();
                pose.pushPose();
                (p.attach().equals("head") ? model.head : model.body).translateAndRotate(pose);
                pose.translate(p.px() / 16f, p.py() / 16f, p.pz() / 16f);
                switch (p.anim()) {
                    case BOB -> pose.translate(0, (float) Math.sin(s.ageInTicks * 0.12) * 0.03f, 0);
                    case FLAP -> {
                        // Dinlenirken yavaş, koşarken hızlı çırpma
                        float speed = s.walkAnimationSpeed > 0.3f ? 0.45f : 0.12f;
                        float open = 0.35f + (float) Math.sin(s.ageInTicks * speed) * 0.25f;
                        pose.mulPose(Axis.YP.rotation(-p.side() * open));
                    }
                    default -> {}
                }
                out.submitModelPart(bp.part(), pose, type, lit, OverlayTexture.NO_OVERLAY, null);
                pose.popPose();
            }
        }
    }

    private static int tick;

    /** Aura: oyuncunun etrafında parçacıklar (birinci şahıs görüşte görüşü kapatmasın diye yalnızca üçüncü şahısta) */
    public static void tick(Minecraft mc) {
        if (mc.player == null || mc.level == null || mc.isPaused()) return;
        String kind = Cosmetics.aura(equipped("aura"));
        if (kind == null || mc.options.getCameraType().isFirstPerson()) return;
        if (++tick % 5 != 0) return;
        var p = mc.player;
        double a = tick * 0.35, r = 0.65;
        double x = p.getX() + Math.cos(a) * r, z = p.getZ() + Math.sin(a) * r;
        ParticleOptions type = switch (kind) {
            case "heart" -> ParticleTypes.HEART;
            case "note" -> ParticleTypes.NOTE;
            case "flame" -> ParticleTypes.SMALL_FLAME;
            default -> ParticleTypes.END_ROD;
        };
        double y = kind.equals("flame") ? p.getY() + 0.1 : p.getY() + 0.6 + Math.sin(a * 0.5) * 0.6;
        double vx = kind.equals("note") ? (tick % 24) / 24.0 : 0;
        mc.level.addParticle(type, x, y, z, vx, kind.equals("star") ? 0.01 : 0, 0);
    }
}
