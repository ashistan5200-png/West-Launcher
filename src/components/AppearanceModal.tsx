import { useEffect, useState } from "react";
import { ImagePlus, Loader2, Shuffle, Trash2 } from "lucide-react";
import clsx from "clsx";
import { Modal } from "./Modal";
import { CoverArt } from "./CoverArt";
import { InstanceIcon } from "./InstanceIcon";
import { InstanceBanner } from "./InstanceBanner";
import { pickCropped } from "./ImageCropper";
import { api } from "@/lib/ipc";
import { useInstances } from "@/stores/instances";
import type { Instance } from "@/lib/types";
import { tx } from "@/lib/i18n";

/** Instance'ın görünümü: ad, profil fotoğrafı (simge) ve banner. */
export function AppearanceModal({ instance, open, onClose }: { instance: Instance; open: boolean; onClose: () => void }) {
  const refresh = useInstances((s) => s.refresh);
  const [name, setName] = useState(instance.name);
  const [seeds, setSeeds] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cur, setCur] = useState(instance);

  useEffect(() => {
    if (!open) return;
    setCur(instance);
    setName(instance.name);
    setSeeds(Array.from({ length: 8 }, () => Math.random().toString(36).slice(2, 10)));
    setError(null);
  }, [open, instance]);

  const run = async (key: string, fn: () => Promise<Instance | void>) => {
    setBusy(key);
    setError(null);
    try {
      const next = await fn();
      if (next) setCur(next);
      await refresh();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };
  const pick = (kind: "icon" | "banner") =>
    run(kind, async () => {
      const p = await pickCropped(kind === "icon"
        ? { aspect: 1, title: tx("Profil fotoğrafını ayarla"), outWidth: 512 }
        : { aspect: 4, title: tx("Banner'ı ayarla"), outWidth: 1600 });
      if (!p) return;
      return api.setInstanceImage(instance.id, kind, p);
    });
  const save = (patch: Partial<Instance>) => run("save", async () => api.updateInstance({ ...cur, ...patch }));

  return (
    <Modal open={open} onClose={onClose} title={tx("Görünümü düzenle")} width={640}
      footer={<button className="btn btn-primary" onClick={onClose}>{tx("Bitti")}</button>}>
      <div className="appear">
        <div className="appear-preview">
          <InstanceBanner instance={cur} className="appear-banner" wide />
          <div className="appear-shade" />
          <div className="appear-id">
            <InstanceIcon instance={cur} size={64} />
            <strong>{name || cur.name}</strong>
          </div>
        </div>

        <label className="field">
          <span>{tx("Ad")}</span>
          <div className="row">
            <input className="grow" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-ghost" disabled={!name.trim() || name === cur.name || busy === "save"} onClick={() => void save({ name: name.trim() })}>{tx("Kaydet")}</button>
          </div>
        </label>

        <div className="field">
          <span>{tx("Profil fotoğrafı")}</span>
          <div className="row">
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => void pick("icon")}>{busy === "icon" ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />} {tx("Görsel seç")}</button>
            {cur.icon && <button className="btn btn-danger-ghost" disabled={!!busy} onClick={() => void run("icon-rm", () => api.setInstanceImage(instance.id, "icon", null))}><Trash2 size={15} /> {tx("Kaldır")}</button>}
            <span className="muted tiny">{tx("Seçtikten sonra konumunu, boyutunu ve yönünü ayarlayabilirsin.")}</span>
          </div>
        </div>

        <div className="field">
          <span>{tx("Banner")}</span>
          <div className="row">
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => void pick("banner")}>{busy === "banner" ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />} {tx("Kendi görselini yükle")}</button>
            {cur.banner && <button className="btn btn-danger-ghost" disabled={!!busy} onClick={() => void run("banner-rm", () => api.setInstanceImage(instance.id, "banner", null))}><Trash2 size={15} /> {tx("Görseli kaldır")}</button>}
          </div>
          <span className="muted tiny" style={{ marginTop: 6 }}>{tx("Ya da bir manzara seç:")}</span>
          <div className="appear-seeds">
            {[cur.coverSeed || cur.id, ...seeds].map((s, i) => (
              <button key={s + i} className={clsx("appear-seed", !cur.banner && (cur.coverSeed || cur.id) === s && "on")} disabled={!!busy}
                onClick={() => void run("seed", async () => {
                  let next = cur;
                  if (cur.banner) next = await api.setInstanceImage(instance.id, "banner", null);
                  return api.updateInstance({ ...next, coverSeed: s });
                })}>
                <CoverArt seed={s} className="appear-seed-art" />
              </button>
            ))}
            <button className="appear-seed shuffle" onClick={() => setSeeds(Array.from({ length: 8 }, () => Math.random().toString(36).slice(2, 10)))} title={tx("Yeni manzaralar")}>
              <Shuffle size={18} />
            </button>
          </div>
        </div>
        {error && <p className="hint error">{error}</p>}
      </div>
    </Modal>
  );
}
