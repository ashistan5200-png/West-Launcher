// Küçük, dosya tabanlı kalıcı depo (uyarılar, vaka sayacı, son duyurulan sürüm).
// Yazmalar sıraya alınır ve önce geçici dosyaya yazılıp taşınır; çökmede dosya bozulmaz.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EMPTY = { warns: {}, caseCounter: 0, lastRelease: null, rolePanel: null };

export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "db.json");
    try {
      this.data = { ...EMPTY, ...JSON.parse(readFileSync(this.file, "utf8")) };
    } catch {
      this.data = structuredClone(EMPTY);
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  nextCase() {
    this.data.caseCounter += 1;
    this.save();
    return this.data.caseCounter;
  }

  addWarn(userId, warn) {
    (this.data.warns[userId] ??= []).push(warn);
    this.save();
    return this.data.warns[userId];
  }

  warns(userId) {
    return this.data.warns[userId] ?? [];
  }

  /** `index` verilirse o uyarıyı, verilmezse hepsini siler. Silinen sayısını döndürür. */
  clearWarns(userId, index) {
    const list = this.data.warns[userId] ?? [];
    let removed = 0;
    if (index === undefined) {
      removed = list.length;
      delete this.data.warns[userId];
    } else if (index >= 1 && index <= list.length) {
      list.splice(index - 1, 1);
      removed = 1;
    }
    this.save();
    return removed;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }
}
