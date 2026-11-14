package dev.west.companion.pvp;

/** Ashi'nin zorluk seviyeleri. Değerler bir oyuncunun refleks ve tekniğini taklit eder. */
public enum BotSkill {
    //            hız   dönüş  sapma  menzil  w-tap  w-tapGec yavaşGec kritik strafe kalkan iyileşCan tepki  s-tap
    EASY("easy",   0.92f, 9f,   7f,   2.55f,  0.10f, 6,       18,      0.10f, 0.25f, 0.20f, 5f,       7,     false),
    NORMAL("normal", 1.0f, 16f,  3.5f, 2.8f,   0.45f, 4,       12,      0.30f, 0.55f, 0.45f, 7f,       4,     false),
    HARD("hard",   1.03f, 28f,  1.5f, 2.95f,  0.75f, 3,       8,       0.55f, 0.80f, 0.65f, 8f,       2,     true),
    MASTER("master", 1.05f, 55f, 0.6f, 3.0f,   0.95f, 2,       5,       0.80f, 1.0f,  0.80f, 9f,       1,     true);

    public final String id;
    public final float speed, turn, jitter, reach, wtap;
    public final int wtapDelay, slowResprint;
    public final float crit, strafe, block, healAt;
    public final int reaction;
    public final boolean stap;

    BotSkill(String id, float speed, float turn, float jitter, float reach, float wtap, int wtapDelay, int slowResprint,
             float crit, float strafe, float block, float healAt, int reaction, boolean stap) {
        this.id = id;
        this.speed = speed;
        this.turn = turn;
        this.jitter = jitter;
        this.reach = reach;
        this.wtap = wtap;
        this.wtapDelay = wtapDelay;
        this.slowResprint = slowResprint;
        this.crit = crit;
        this.strafe = strafe;
        this.block = block;
        this.healAt = healAt;
        this.reaction = reaction;
        this.stap = stap;
    }

    public String key() {
        return "west_companion.pvp.skill." + id;
    }
}
