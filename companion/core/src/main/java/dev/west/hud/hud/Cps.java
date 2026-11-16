package dev.west.hud.hud;

import dev.west.hud.api.Game;

import java.util.ArrayDeque;

/** Saniyedeki tık sayısı: her karede tuşun basılma anını yakalar, son 1 saniyeyi sayar. */
public final class Cps {
    private final ArrayDeque<Long> left = new ArrayDeque<>(), right = new ArrayDeque<>();
    private boolean wasLeft, wasRight;

    public void update(Game game) {
        long now = System.currentTimeMillis();
        boolean l = game.keyDown(Game.Key.ATTACK), r = game.keyDown(Game.Key.USE);
        if (l && !wasLeft) left.addLast(now);
        if (r && !wasRight) right.addLast(now);
        wasLeft = l;
        wasRight = r;
        while (!left.isEmpty() && now - left.peekFirst() > 1000) left.pollFirst();
        while (!right.isEmpty() && now - right.peekFirst() > 1000) right.pollFirst();
    }

    public int left() {
        return left.size();
    }

    public int right() {
        return right.size();
    }
}
