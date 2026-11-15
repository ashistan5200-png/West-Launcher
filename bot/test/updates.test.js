import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseMessage, releaseNotes, releaseTitle } from "../src/updates.js";
import { DEFINITIONS } from "../src/commands.js";

const rel = {
  tag_name: "v0.2.8", name: "0.2.8: tek tıkla akıllı Ashi ve yeni Ayarlar", html_url: "https://github.com/x/y/releases/tag/v0.2.8",
  published_at: "2026-11-15T16:20:00Z",
  body: "- Ashi artık anahtar istemez.\n- Ayarlar yenilendi.\n\n\n\nCo-Authored-By: X <x@y>\nClaude-Session: https://z",
};

test("sürüm notları temizlenir", () => {
  const n = releaseNotes(rel.body);
  assert.equal(n, "• Ashi artık anahtar istemez.\n• Ayarlar yenilendi.");
  assert.ok(releaseNotes("x".repeat(5000)).length <= 3500);
});

test("sürüm başlığı", () => {
  assert.equal(releaseTitle(rel), "tek tıkla akıllı Ashi ve yeni Ayarlar");
  assert.equal(releaseTitle({ tag_name: "v0.2.8", name: "v0.2.8" }), "Yeni sürüm");
});

test("duyuru mesajı geçerli", () => {
  const m = releaseMessage(rel, { id: "1", toString: () => "<@&1>" });
  const e = m.embeds[0].toJSON();
  assert.match(e.title, /v0\.2\.8 yayında/);
  assert.equal(m.components[0].toJSON().components.length, 4);
  assert.deepEqual(m.allowedMentions.roles, ["1"]);
});

test("komut tanımları Discord kurallarına uyar", () => {
  const names = DEFINITIONS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length <= 100);
  for (const c of DEFINITIONS) assert.match(c.name, /^[-_a-z0-9]{1,32}$/);
});
