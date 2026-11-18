package dev.west.companion.v26.mixin;

import com.mojang.blaze3d.textures.GpuTexture;
import com.mojang.blaze3d.textures.GpuTextureView;
import net.minecraft.client.gui.render.pip.PictureInPictureRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Lobi kapanınca (oyuna girilince) tam ekran sahne dokusunu GPU belleğinden bırakmak için */
@Mixin(PictureInPictureRenderer.class)
public interface PipTextureAccessor {
    @Accessor("texture") GpuTexture west$texture();
    @Accessor("texture") void west$setTexture(GpuTexture t);
    @Accessor("textureView") GpuTextureView west$textureView();
    @Accessor("textureView") void west$setTextureView(GpuTextureView t);
    @Accessor("depthTexture") GpuTexture west$depthTexture();
    @Accessor("depthTexture") void west$setDepthTexture(GpuTexture t);
    @Accessor("depthTextureView") GpuTextureView west$depthTextureView();
    @Accessor("depthTextureView") void west$setDepthTextureView(GpuTextureView t);
}
