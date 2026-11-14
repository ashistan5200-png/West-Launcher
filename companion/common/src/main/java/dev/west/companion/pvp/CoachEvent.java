package dev.west.companion.pvp;

/** Sunucu iş parçacığından istemcideki koça giden olaylar (aynı JVM, kuyruk üzerinden). */
public sealed interface CoachEvent {
    record Started(Kit kit, BotSkill skill, int bestOf) implements CoachEvent {}

    record AshiHeal(Kit.Heal heal) implements CoachEvent {}

    /** Bir vuruş kalkanla engellendi. `playerShield`: oyuncu Ashi'yi engelledi; aksi halde Ashi oyuncuyu. */
    record ShieldBlock(boolean playerShield, boolean axe) implements CoachEvent {}

    record RoundEnd(boolean playerWon, int you, int ashi, int round) implements CoachEvent {}

    record MatchEnd(Boolean playerWon, int you, int ashi, Kit kit, BotSkill skill, int bestOf,
                    int ashiHits, int ashiCrits, int ashiSprintHits, int ashiHeals) implements CoachEvent {}

    record Failed(String reason) implements CoachEvent {}
}
