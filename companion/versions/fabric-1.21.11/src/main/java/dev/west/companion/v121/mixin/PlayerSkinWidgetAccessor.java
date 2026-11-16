package dev.west.companion.v121.mixin;

import net.minecraft.client.gui.components.PlayerSkinWidget;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Ana menüdeki dönen yarım gövde için modelin döndürme açılarına erişim */
@Mixin(PlayerSkinWidget.class)
public interface PlayerSkinWidgetAccessor {
    @Accessor("rotationY")
    void west$setRotationY(float v);

    @Accessor("rotationX")
    void west$setRotationX(float v);
}
