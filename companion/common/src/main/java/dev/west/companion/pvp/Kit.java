package dev.west.companion.pvp;

import net.minecraft.core.Holder;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.alchemy.PotionContents;
import net.minecraft.world.item.alchemy.Potions;
import net.minecraft.world.item.component.Unbreakable;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.Enchantments;

/**
 * Antrenman kitleri. Oyuncu ve Ashi aynı kiti alır; yalnızca iyileşme
 * eşyalarını Ashi envanter yerine sayaçla kullanır.
 */
public enum Kit {
    /** Saf kılıç: zamanlama, kritik vuruş, w-tap */
    SWORD("sword", Heal.NONE, 0, 1, 13, false),
    /** Balta + kalkan: kalkanı doğru anda kaldır, baltayla kalkan kır */
    AXE_SHIELD("axe", Heal.NONE, 0, 1, 20, true),
    /** Altın elma: geri çekilip doğru anda iyileşme */
    GAPPLE("gapple", Heal.GAPPLE, 6, 3, 13, false),
    /** İksir (NoDebuff): ayağına iksir atma, hız yönetimi */
    POT("pot", Heal.POT, 8, 2, 13, false);

    public enum Heal { NONE, GAPPLE, POT }

    public final String id;
    public final Heal heal;
    public final int heals;
    private final int level;
    /** Ashi'nin vuruşlar arası bekleme süresi (tick) — silahın saldırı hızına göre */
    public final int cooldown;
    public final boolean shield;

    Kit(String id, Heal heal, int heals, int level, int cooldown, boolean shield) {
        this.id = id;
        this.heal = heal;
        this.heals = heals;
        this.level = level;
        this.cooldown = cooldown;
        this.shield = shield;
    }

    public String key() {
        return "west_companion.pvp.kit." + id;
    }

    private static ItemStack tough(Item item) {
        ItemStack s = new ItemStack(item);
        s.set(DataComponents.UNBREAKABLE, new Unbreakable(false));
        return s;
    }

    private static void ench(ItemStack s, RegistryAccess ra, ResourceKey<Enchantment> key, int lvl) {
        if (lvl <= 0) return;
        Holder<Enchantment> h = ra.registryOrThrow(Registries.ENCHANTMENT).getHolderOrThrow(key);
        s.enchant(h, lvl);
    }

    private ItemStack armor(Item item, RegistryAccess ra) {
        ItemStack s = tough(item);
        ench(s, ra, Enchantments.PROTECTION, level - 1);
        return s;
    }

    public ItemStack weapon(RegistryAccess ra) {
        ItemStack s = tough(this == AXE_SHIELD ? Items.DIAMOND_AXE : Items.DIAMOND_SWORD);
        ench(s, ra, Enchantments.SHARPNESS, level - 1);
        return s;
    }

    private void armorTo(LivingEntity e, RegistryAccess ra) {
        e.setItemSlot(EquipmentSlot.HEAD, armor(Items.DIAMOND_HELMET, ra));
        e.setItemSlot(EquipmentSlot.CHEST, armor(Items.DIAMOND_CHESTPLATE, ra));
        e.setItemSlot(EquipmentSlot.LEGS, armor(Items.DIAMOND_LEGGINGS, ra));
        e.setItemSlot(EquipmentSlot.FEET, armor(Items.DIAMOND_BOOTS, ra));
    }

    public static ItemStack healPotion() {
        return PotionContents.createItemStack(Items.SPLASH_POTION, Potions.STRONG_HEALING);
    }

    /** Oyuncunun envanterini temizler ve kiti verir. */
    public void giveTo(Player p) {
        RegistryAccess ra = p.registryAccess();
        Inventory inv = p.getInventory();
        inv.clearContent();
        armorTo(p, ra);
        inv.setItem(0, weapon(ra));
        int slot = 1;
        if (this == AXE_SHIELD) {
            ItemStack sword = tough(Items.DIAMOND_SWORD);
            inv.setItem(slot++, sword);
            p.setItemSlot(EquipmentSlot.OFFHAND, tough(Items.SHIELD));
        }
        if (heal == Heal.GAPPLE) inv.setItem(slot++, new ItemStack(Items.GOLDEN_APPLE, heals));
        if (heal == Heal.POT) for (int i = 0; i < heals; i++) inv.setItem(slot++, healPotion());
        inv.setItem(8, new ItemStack(Items.COOKED_BEEF, 16));
        applyEffects(p);
    }

    /** Ashi'ye aynı ekipman (iyileşme eşyaları sayaçla tutulur). */
    public void giveTo(Mob bot) {
        RegistryAccess ra = bot.registryAccess();
        armorTo(bot, ra);
        bot.setItemSlot(EquipmentSlot.MAINHAND, weapon(ra));
        bot.setItemSlot(EquipmentSlot.OFFHAND, shield ? tough(Items.SHIELD) : ItemStack.EMPTY);
        for (EquipmentSlot s : EquipmentSlot.values()) bot.setDropChance(s, 0f);
        applyEffects(bot);
    }

    private void applyEffects(LivingEntity e) {
        e.removeAllEffects();
        if (this == POT) e.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 20 * 60 * 15, 1, false, false, true));
    }
}
