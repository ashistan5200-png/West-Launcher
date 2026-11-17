package dev.west.companion.v26.mixin;

import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.resources.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

/** West shader'ını (Minecraft'ın kendi efekt sistemiyle) açabilmek için */
@Mixin(GameRenderer.class)
public interface GameRendererInvoker {
    @Invoker("setPostEffect")
    void west$setPostEffect(Identifier id);
}
