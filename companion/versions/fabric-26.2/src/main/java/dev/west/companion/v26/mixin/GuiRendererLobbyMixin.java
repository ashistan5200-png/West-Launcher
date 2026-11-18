package dev.west.companion.v26.mixin;

import dev.west.companion.v26.LobbyRender26;
import net.minecraft.client.gui.render.GuiRenderer;
import net.minecraft.client.gui.render.pip.PictureInPictureRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

import java.util.ArrayList;
import java.util.List;

/** Lobi sahnesinin çizicisini GUI'nin "resim içinde resim" çizicilerine ekler. */
@Mixin(GuiRenderer.class)
public class GuiRendererLobbyMixin {
    @ModifyVariable(method = "<init>", at = @At("HEAD"), argsOnly = true)
    private static List<PictureInPictureRenderer<?>> west$addLobby(List<PictureInPictureRenderer<?>> list) {
        List<PictureInPictureRenderer<?>> l = new ArrayList<>(list);
        l.add(new LobbyRender26.Renderer());
        return l;
    }
}
