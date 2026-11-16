package dev.west.companion.v121.mixin;

import dev.west.companion.v121.Gfx121;
import dev.west.hud.WestHud;
import dev.west.hud.ui.Skin;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractSelectionList;
import net.minecraft.client.gui.screens.multiplayer.ServerSelectionList;
import net.minecraft.client.gui.screens.worldselection.WorldSelectionList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Listeler West görünümünde: Dünyalar ve Çok oyunculu listesinde her satır yuvarlak bir kart,
 * tüm listelerde seçili satır beyaz kutu yerine turuncu tonlu kart.
 */
@Mixin(AbstractSelectionList.class)
abstract class ListSkinMixin {
    @Shadow private AbstractSelectionList.Entry<?> hovered;

    private boolean west$cards() {
        Object self = this;
        return self instanceof WorldSelectionList || self instanceof ServerSelectionList;
    }

    @Inject(method = "renderItem", at = @At("HEAD"), require = 0)
    private void west$card(GuiGraphics g, int mx, int my, float delta, AbstractSelectionList.Entry<?> e, CallbackInfo ci) {
        if (!Skin.on() || !west$cards()) return;
        WestHud.safe("skin-row", () -> Skin.listRow(new Gfx121(g), e.getX(), e.getY(), e.getWidth(), e.getHeight(), e == hovered));
    }

    @Inject(method = "renderSelection", at = @At("HEAD"), cancellable = true, require = 0)
    private void west$selected(GuiGraphics g, AbstractSelectionList.Entry<?> e, int color, CallbackInfo ci) {
        if (!Skin.on()) return;
        boolean[] done = {false};
        WestHud.safe("skin-selected", () -> { Skin.listSelected(new Gfx121(g), e.getX(), e.getY(), e.getWidth(), e.getHeight(), ((net.minecraft.client.gui.components.AbstractWidget) (Object) this).isFocused()); done[0] = true; });
        if (done[0]) ci.cancel();
    }
}
