package dev.west.companion.v121.mixin;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import dev.west.companion.v121.Gfx121;
import dev.west.hud.WestHud;
import dev.west.hud.ui.Skin;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.resources.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Dünya satırındaki pikselli "oyna" oku yerine pürüzsüz yuvarlak düğme. Uyarı simgeleri vanilla kalır. */
@Mixin(targets = "net.minecraft.client.gui.screens.worldselection.WorldSelectionList$WorldListEntry")
abstract class WorldEntrySkinMixin {
    @Redirect(method = "renderContent", require = 0, at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/gui/GuiGraphics;blitSprite(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIII)V"))
    private void west$skin(GuiGraphics g, RenderPipeline p, Identifier id, int x, int y, int w, int h) {
        String path = id.getPath();
        boolean join = path.endsWith("world_list/join") || path.endsWith("world_list/join_highlighted");
        if (!join || !Skin.on()) { g.blitSprite(p, id, x, y, w, h); return; }
        boolean[] done = {false};
        WestHud.safe("skin-join", () -> { Skin.playIcon(new Gfx121(g), x, y, w, h, path.endsWith("highlighted")); done[0] = true; });
        if (!done[0]) g.blitSprite(p, id, x, y, w, h);
    }
}
