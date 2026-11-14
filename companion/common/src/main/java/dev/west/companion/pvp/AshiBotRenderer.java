package dev.west.companion.pvp;

import dev.west.companion.West;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.PlayerModel;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.HumanoidMobRenderer;
import net.minecraft.client.renderer.entity.layers.HumanoidArmorLayer;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.monster.Vindicator;
import net.minecraft.world.item.Items;

/** Antrenman botunu AshiWest skinli bir oyuncu gibi çizer (zırh, eldeki eşya, kalkan pozu). */
public class AshiBotRenderer extends HumanoidMobRenderer<Vindicator, AshiBotRenderer.Model> {
    private static final ResourceLocation SKIN = ResourceLocation.fromNamespaceAndPath(West.MOD_ID, "textures/entity/ashi.png");
    public static AshiBotRenderer instance;

    public AshiBotRenderer(EntityRendererProvider.Context ctx) {
        super(ctx, new Model(ctx.bakeLayer(ModelLayers.PLAYER)), 0.5f);
        addLayer(new HumanoidArmorLayer<>(this,
                new HumanoidModel<>(ctx.bakeLayer(ModelLayers.PLAYER_INNER_ARMOR)),
                new HumanoidModel<>(ctx.bakeLayer(ModelLayers.PLAYER_OUTER_ARMOR)),
                ctx.getModelManager()));
    }

    public static boolean isBot(Entity e) {
        Duel.State s = Duel.state;
        return e instanceof Vindicator && s != null && e.getUUID().equals(s.bot());
    }

    @Override
    public ResourceLocation getTextureLocation(Vindicator e) {
        return SKIN;
    }

    public static class Model extends PlayerModel<Vindicator> {
        Model(ModelPart root) {
            super(root, false);
        }

        @Override
        public void prepareMobModel(Vindicator e, float limbSwing, float limbSwingAmount, float partialTick) {
            super.prepareMobModel(e, limbSwing, limbSwingAmount, partialTick);
            rightArmPose = e.getMainHandItem().isEmpty() ? ArmPose.EMPTY : ArmPose.ITEM;
            leftArmPose = e.getOffhandItem().isEmpty() ? ArmPose.EMPTY : ArmPose.ITEM;
            if (e.isUsingItem() && e.getUsedItemHand() == InteractionHand.OFF_HAND && e.getUseItem().is(Items.SHIELD)) leftArmPose = ArmPose.BLOCK;
            crouching = false;
        }
    }
}
