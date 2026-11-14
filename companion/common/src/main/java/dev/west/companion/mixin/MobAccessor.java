package dev.west.companion.mixin;

import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.goal.GoalSelector;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Ashi botunun vanilla yapay zekâsını kapatmak için. */
@Mixin(Mob.class)
public interface MobAccessor {
    @Accessor("goalSelector")
    GoalSelector west$goals();

    @Accessor("targetSelector")
    GoalSelector west$targets();
}
