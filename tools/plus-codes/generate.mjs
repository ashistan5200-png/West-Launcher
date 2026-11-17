#!/usr/bin/env node
/**
 * West+ kod üretici.
 *
 *   node tools/plus-codes/generate.mjs <plan> <adet> [parti-adı]
 *   plan: month (30 gün) | quarter (90 gün) | year (365 gün)
 *
 * Çıktı (tools/plus-codes/out/, git'e girmez):
 *   <parti>.csv  → e-pin sitesine (itemsatış vb.) yüklenecek kodlar. KİMSEYLE PAYLAŞMA.
 *   <parti>.sql  → Supabase → SQL Editor'a yapıştır. Yalnızca kodların özetini içerir.
 *
 * Kodlar kriptografik rastgele üretilir: WEST-XXXX-XXXX-XXXX-XXXX (80 bit).
 * Karışabilecek harfler (0/O, 1/I/L, 5/S, 8/B) kullanılmaz.
 */
import { createHash, randomInt } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLANS = { month: 30, quarter: 90, year: 365 };
const ALPHABET = "ACDEFGHJKMNPQRTUVWXYZ234679"; // 27 karakter

const [plan, countArg, batchArg] = process.argv.slice(2);
if (!PLANS[plan] || !countArg) {
  console.error("Kullanım: node tools/plus-codes/generate.mjs <month|quarter|year> <adet> [parti-adı]");
  process.exit(1);
}
const count = Number(countArg);
if (!Number.isInteger(count) || count < 1 || count > 5000) {
  console.error("Adet 1 ile 5000 arasında olmalı.");
  process.exit(1);
}
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const batch = (batchArg || `${plan}-${stamp}`).replace(/[^A-Za-z0-9_-]/g, "");

const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
// Sunucudaki ile birebir aynı normalleştirme: yalnızca harf/rakam, büyük harf
const normalize = (c) => c.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const hash = (c) => createHash("sha256").update(normalize(c)).digest("hex");

const codes = new Set();
while (codes.size < count) codes.add(`WEST-${group()}-${group()}-${group()}-${group()}`);

const out = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(out, { recursive: true });
const csv = join(out, `${batch}.csv`);
const sql = join(out, `${batch}.sql`);
if (existsSync(csv) || existsSync(sql)) {
  console.error(`"${batch}" adlı parti zaten var; başka bir ad ver.`);
  process.exit(1);
}

writeFileSync(csv, "kod,plan,gun\n" + [...codes].map((c) => `${c},${plan},${PLANS[plan]}`).join("\n") + "\n", { mode: 0o600 });
const rows = [...codes].map((c) => `  ('${hash(c)}', '${plan}', ${PLANS[plan]}, '${batch}')`);
writeFileSync(
  sql,
  `-- West+ kod partisi: ${batch} (${count} adet, ${plan})\n` +
    `insert into public.plus_codes (code_hash, plan, days, batch) values\n${rows.join(",\n")}\non conflict (code_hash) do nothing;\n`,
);

console.log(`${count} kod üretildi (${plan}, ${PLANS[plan]} gün).`);
console.log(`  Satış listesi : ${csv}`);
console.log(`  Supabase SQL  : ${sql}`);
console.log("Önce SQL'i Supabase'e yapıştırıp çalıştır, sonra kodları satışa koy.");
