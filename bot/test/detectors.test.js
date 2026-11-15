import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeLinks, escalation, NukeGuard, parseDuration, RaidDetector, SpamTracker } from "../src/detectors.js";
import { CONFIG } from "../src/config.js";

test("spam: hızlı mesaj", () => {
  const s = new SpamTracker(CONFIG.spam);
  const results = Array.from({ length: 6 }, (_, k) => s.check("u", `mesaj ${k}`, 0, 1000 + k * 500));
  assert.deepEqual(results.slice(0, 5), [null, null, null, null, null]);
  assert.equal(results[5], "burst");
});

test("spam: normal sohbet spam sayılmaz", () => {
  const s = new SpamTracker(CONFIG.spam);
  for (let k = 0; k < 20; k++) assert.equal(s.check("u", `selam ${k}`, 0, k * 3000), null);
});

test("spam: aynı metin kanallar arası", () => {
  const s = new SpamTracker(CONFIG.spam);
  assert.equal(s.check("u", "Sunucuma gelin!!", 0, 0), null);
  assert.equal(s.check("u", "sunucuma   gelin!!", 0, 5000), null);
  assert.equal(s.check("u", "SUNUCUMA GELIN!!", 0, 10_000), "duplicate");
  // "ok" gibi kısa cevaplar tekrar sayılmaz
  const t = new SpamTracker(CONFIG.spam);
  for (let k = 0; k < 4; k++) assert.equal(t.check("v", "ok", 0, k * 5000), null);
});

test("spam: toplu etiket", () => {
  assert.equal(new SpamTracker(CONFIG.spam).check("u", "hey", 5, 0), "mentions");
});

test("raid: eşik ve süre", () => {
  const r = new RaidDetector(CONFIG.raid);
  const fired = Array.from({ length: 8 }, (_, k) => r.join(k * 1000));
  assert.equal(fired.filter(Boolean).length, 1);
  assert.equal(fired[7], true);
  assert.ok(r.active(10_000));
  assert.ok(!r.active(7000 + CONFIG.raid.durationMs + 1));
  // Yavaş girişler raid değildir
  const slow = new RaidDetector(CONFIG.raid);
  for (let k = 0; k < 30; k++) assert.equal(slow.join(k * 10_000), false);
});

test("anti-nuke: sınır kişi ve tür başına", () => {
  const n = new NukeGuard(CONFIG.nuke);
  assert.equal(n.record("a", "channelDelete", 0), false);
  assert.equal(n.record("b", "channelDelete", 100), false);
  assert.equal(n.record("a", "channelDelete", 200), false);
  assert.equal(n.record("a", "roleDelete", 300), false);
  assert.equal(n.record("a", "channelDelete", 400), true);
  assert.equal(n.record("a", "channelDelete", 400 + 61_000), false); // pencere geçti
  assert.equal(n.record("a", "unknown", 0), false);
});

test("bağlantılar: dolandırıcılık ve davetler", () => {
  assert.equal(analyzeLinks("bak https://discord.com/channels/1/2"), null);
  assert.equal(analyzeLinks("https://modrinth.com/mod/sodium güzel"), null);
  assert.equal(analyzeLinks("https://cdn.discordapp.com/attachments/x.png"), null);
  assert.equal(analyzeLinks("https://dlscord-gift.com/nitro")?.kind, "phishing");
  assert.equal(analyzeLinks("https://www.planetminecraft.com/x"), null);
  assert.equal(analyzeLinks("https://www.minecraftskins.com/skin/1"), null);
  assert.equal(analyzeLinks("https://store.epicgames.com/tr/"), null);
  assert.equal(analyzeLinks("https://epicgames-free.store/x")?.kind, "phishing");
  assert.equal(analyzeLinks("https://www.minecraft.net/tr-tr"), null);
  assert.equal(analyzeLinks("free nitro https://d1sc0rd-nitro.ru/claim")?.kind, "phishing");
  assert.equal(analyzeLinks("https://steamcommunlty-gift.com/trade")?.kind, "phishing");
  assert.equal(analyzeLinks("@everyone bedava nitro https://bit.ly/xyz")?.kind, "phishing");
  assert.equal(analyzeLinks("gel https://discord.gg/baskasunucu")?.kind, "invite");
  assert.equal(analyzeLinks("gel https://discord.gg/bizimkod", new Set(["bizimkod"])), null);
  assert.equal(analyzeLinks("normal bir mesaj"), null);
});

test("uyarı cezası yalnızca eşikte", () => {
  const steps = CONFIG.warnEscalation;
  const w = (n, at = 0) => Array.from({ length: n }, () => ({ at }));
  assert.equal(escalation(w(2), steps, CONFIG.warnWindowMs, 1), null);
  assert.equal(escalation(w(3), steps, CONFIG.warnWindowMs, 1)?.ms, 3600_000);
  assert.equal(escalation(w(4), steps, CONFIG.warnWindowMs, 1), null);
  assert.equal(escalation(w(5), steps, CONFIG.warnWindowMs, 1)?.ms, 864e5);
  assert.equal(escalation(w(7), steps, CONFIG.warnWindowMs, 1)?.action, "kick");
  // Eski uyarılar sayılmaz
  assert.equal(escalation(w(3, 0), steps, CONFIG.warnWindowMs, CONFIG.warnWindowMs + 1), null);
});

test("süre ayrıştırma", () => {
  assert.equal(parseDuration("10dk"), 600_000);
  assert.equal(parseDuration("10"), 600_000);
  assert.equal(parseDuration("2s"), 7_200_000);
  assert.equal(parseDuration("1g"), 864e5);
  assert.equal(parseDuration("1hf"), 6048e5);
  assert.equal(parseDuration("30g"), null); // 28 günden uzun
  assert.equal(parseDuration("yarın"), null);
});
