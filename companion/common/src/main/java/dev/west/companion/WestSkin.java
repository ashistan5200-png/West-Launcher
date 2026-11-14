package dev.west.companion;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.platform.NativeImage;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.client.resources.PlayerSkin;
import net.minecraft.resources.ResourceLocation;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Offline hesaplar için launcher'ın seçtiği skin. Launcher oyunu başlatırken
 * `west/skin.png` + `west/skin.json` yazar; mod bunu yalnızca yerel oyuncuya uygular.
 * Microsoft hesaplarında dosya yazılmaz ve Mojang skini kullanılır.
 */
public final class WestSkin {
    private static final ResourceLocation TEXTURE = ResourceLocation.fromNamespaceAndPath(West.MOD_ID, "skin/local");
    private static PlayerSkin skin;
    private static boolean tried;

    private WestSkin() {}

    /** Yoksa null; ilk çağrıda yükler (render iş parçacığında çağrılmalı). */
    public static PlayerSkin get() {
        if (tried) return skin;
        tried = true;
        try {
            Path dir = West.platform.gameDir().resolve("west");
            Path png = dir.resolve("skin.png");
            Path meta = dir.resolve("skin.json");
            if (!Files.exists(png) || !Files.exists(meta)) return null;
            JsonObject j = JsonParser.parseString(Files.readString(meta)).getAsJsonObject();
            if (!j.has("offline") || !j.get("offline").getAsBoolean()) return null;
            boolean slim = j.has("slim") && j.get("slim").getAsBoolean();
            try (InputStream in = Files.newInputStream(png)) {
                NativeImage img = NativeImage.read(in);
                Minecraft.getInstance().getTextureManager().register(TEXTURE, new DynamicTexture(img));
            }
            skin = new PlayerSkin(TEXTURE, null, null, null, slim ? PlayerSkin.Model.SLIM : PlayerSkin.Model.WIDE, false);
            West.LOG.info("West: offline skin yüklendi ({})", slim ? "ince kol" : "klasik");
        } catch (Throwable t) {
            SafeHook.disable("skin", t);
        }
        return skin;
    }
}
