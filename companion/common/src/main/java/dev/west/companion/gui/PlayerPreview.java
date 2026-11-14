package dev.west.companion.gui;

import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import dev.west.companion.West;
import dev.west.companion.WestSkin;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.model.PlayerModel;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.client.resources.DefaultPlayerSkin;
import net.minecraft.client.resources.PlayerSkin;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.item.ItemDisplayContext;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/**
 * Ana menüdeki animasyonlu oyuncu: dünya/varlık gerektirmeden doğrudan
 * PlayerModel çizer. Pozlar: "idle" (nefes), "hero" (elde kılıç), "wave" (selam).
 * Fareyle sürükleyerek döndürülebilir.
 */
public final class PlayerPreview {
    private final PlayerModel<?> wide;
    private final PlayerModel<?> slim;
    private final long start = System.currentTimeMillis();
    private final ItemStack sword = new ItemStack(Items.DIAMOND_SWORD);
    public float yaw = -24f;

    public PlayerPreview() {
        Minecraft mc = Minecraft.getInstance();
        wide = new PlayerModel<>(mc.getEntityModels().bakeLayer(ModelLayers.PLAYER), false);
        slim = new PlayerModel<>(mc.getEntityModels().bakeLayer(ModelLayers.PLAYER_SLIM), true);
        wide.young = false;
        slim.young = false;
    }

    static PlayerSkin currentSkin() {
        PlayerSkin west = WestSkin.get();
        if (west != null) return west;
        Minecraft mc = Minecraft.getInstance();
        try {
            return mc.getSkinManager().getInsecureSkin(mc.getGameProfile());
        } catch (Throwable t) {
            return DefaultPlayerSkin.get(mc.getUser().getProfileId());
        }
    }

    private void pose(PlayerModel<?> m, String pose, float t) {
        float breathe = Mth.sin(t * 2.0f) * 0.035f;
        m.head.xRot = Mth.sin(t * 0.9f) * 0.05f;
        m.head.yRot = Mth.sin(t * 0.55f) * 0.18f;
        m.body.yRot = 0f;
        m.rightArm.xRot = 0f; m.rightArm.yRot = 0f; m.rightArm.zRot = 0.06f + breathe;
        m.leftArm.xRot = 0f; m.leftArm.yRot = 0f; m.leftArm.zRot = -0.06f - breathe;
        m.rightLeg.xRot = 0f; m.leftLeg.xRot = 0f;
        switch (pose) {
            case "hero" -> {
                // Kılıç önde, ağırlık geride — hafif nefes ve kılıç salınımı
                m.rightArm.xRot = -0.85f + Mth.sin(t * 1.6f) * 0.04f;
                m.rightArm.yRot = -0.3f;
                m.leftArm.xRot = 0.3f;
                m.leftArm.zRot = -0.2f - breathe;
                m.rightLeg.xRot = -0.22f;
                m.leftLeg.xRot = 0.22f;
                m.body.yRot = 0.12f;
            }
            case "wave" -> {
                m.rightArm.xRot = (float) -Math.PI;
                m.rightArm.zRot = Mth.sin(t * 7f) * 0.45f + 0.25f;
            }
            default -> { }
        }
        m.hat.copyFrom(m.head);
        m.jacket.copyFrom(m.body);
        m.rightSleeve.copyFrom(m.rightArm);
        m.leftSleeve.copyFrom(m.leftArm);
        m.rightPants.copyFrom(m.rightLeg);
        m.leftPants.copyFrom(m.leftLeg);
    }

    /** (cx, bottom) ayakların merkezi; height piksel cinsinden model boyu. */
    public void render(GuiGraphics g, int cx, int bottom, int height, float appear) {
        PlayerSkin skin = currentSkin();
        PlayerModel<?> m = skin.model() == PlayerSkin.Model.SLIM ? slim : wide;
        float t = (System.currentTimeMillis() - start) / 1000f;
        String pose = West.config.pose;
        pose(m, pose, t);

        PoseStack ps = g.pose();
        ps.pushPose();
        float bob = Mth.sin(t * 2.0f) * 1.2f;
        ps.translate(cx, bottom + bob + (1f - appear) * 18f, 150f);
        // Model koordinatlarında y aşağı doğru artar (GUI ile aynı): kafa üstü −0.5,
        // ayaklar +1.5 → toplam 2 birim. Ayakları çapaya oturt, z'yi ekrana doğru çevir.
        float scale = height / 2.0f * (0.92f + appear * 0.08f);
        ps.scale(scale, scale, scale);
        ps.scale(1f, 1f, -1f);
        ps.translate(0f, -1.5f, 0f);
        ps.mulPose(Axis.YP.rotationDegrees(yaw + Mth.sin(t * 0.4f) * 4f));
        g.flush();
        Lighting.setupForEntityInInventory();

        MultiBufferSource.BufferSource buf = g.bufferSource();
        m.renderToBuffer(ps, buf.getBuffer(m.renderType(skin.texture())), 0xF000F0, OverlayTexture.NO_OVERLAY);

        if ("hero".equals(pose)) {
            ps.pushPose();
            m.translateToHand(HumanoidArm.RIGHT, ps);
            ps.mulPose(Axis.XP.rotationDegrees(-90f));
            ps.mulPose(Axis.YP.rotationDegrees(180f));
            ps.translate(-1f / 16f, 0.125f, -0.625f);
            Minecraft.getInstance().getItemRenderer().renderStatic(sword, ItemDisplayContext.THIRD_PERSON_RIGHT_HAND, 0xF000F0, OverlayTexture.NO_OVERLAY, ps, buf, null, 0);
            ps.popPose();
        }
        g.flush();
        Lighting.setupFor3DItems();
        ps.popPose();
    }
}
