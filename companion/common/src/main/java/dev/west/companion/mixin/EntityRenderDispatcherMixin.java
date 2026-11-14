package dev.west.companion.mixin;

import dev.west.companion.SafeHook;
import dev.west.companion.pvp.AshiBotRenderer;
import net.minecraft.client.gui.Font;
import net.minecraft.client.model.geom.EntityModelSet;
import net.minecraft.client.renderer.ItemInHandRenderer;
import net.minecraft.client.renderer.block.BlockRenderDispatcher;
import net.minecraft.client.renderer.entity.EntityRenderDispatcher;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.ItemRenderer;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Yalnızca antrenman botu (UUID ile) Ashi olarak çizilir; diğer varlıklara dokunulmaz. */
@Mixin(EntityRenderDispatcher.class)
abstract class EntityRenderDispatcherMixin {
    @Shadow @Final private ItemRenderer itemRenderer;
    @Shadow @Final private BlockRenderDispatcher blockRenderDispatcher;
    @Shadow @Final private ItemInHandRenderer itemInHandRenderer;
    @Shadow @Final private EntityModelSet entityModels;
    @Shadow @Final private Font font;

    @Inject(method = "onResourceManagerReload", at = @At("TAIL"))
    private void west$buildAshi(ResourceManager rm, CallbackInfo ci) {
        SafeHook.run("bot-render", () -> AshiBotRenderer.instance = new AshiBotRenderer(new EntityRendererProvider.Context(
                (EntityRenderDispatcher) (Object) this, itemRenderer, blockRenderDispatcher, itemInHandRenderer, rm, entityModels, font)));
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Inject(method = "getRenderer", at = @At("HEAD"), cancellable = true)
    private <T extends Entity> void west$ashi(T entity, CallbackInfoReturnable<EntityRenderer<? super T>> cir) {
        if (AshiBotRenderer.instance != null && AshiBotRenderer.isBot(entity)) cir.setReturnValue((EntityRenderer) AshiBotRenderer.instance);
    }
}
