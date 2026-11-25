import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Modal } from "./Modal";
import { api, isTauri } from "@/lib/ipc";
import { LOADER_LABEL, errorText } from "@/lib/format";
import type { LoaderKind, LoaderVersion, ManifestEntry } from "@/lib/types";
import { useInstances } from "@/stores/instances";
import { tx } from "@/lib/i18n";

const LOADERS: LoaderKind[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

export function CreateInstanceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const create = useInstances((s) => s.create);
  const [name, setName] = useState("");
  const [loader, setLoader] = useState<LoaderKind>("fabric");
  const [mc, setMc] = useState("");
  const [snapshots, setSnapshots] = useState(false);
  const [versions, setVersions] = useState<ManifestEntry[]>([]);
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([]);
  const [loaderVersion, setLoaderVersion] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !isTauri()) return;
    api.listMcVersions(snapshots).then((v) => {
      setVersions(v);
      setMc((cur) => cur || v[0]?.id || "");
    }).catch((e) => setErr(errorText(e)));
  }, [open, snapshots]);

  useEffect(() => {
    setLoaderVersions([]);
    setLoaderVersion("");
    if (!open || !mc || loader === "vanilla" || !isTauri()) return;
    let cancelled = false;
    api.listLoaderVersions(loader, mc)
      .then((v) => !cancelled && setLoaderVersions(v))
      .catch(() => !cancelled && setLoaderVersions([]));
    return () => { cancelled = true; };
  }, [open, mc, loader]);

  const noLoaderSupport = loader !== "vanilla" && mc && loaderVersions.length === 0;
  const placeholder = useMemo(() => `${LOADER_LABEL[loader]} ${mc}`.trim(), [loader, mc]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const inst = await create({
        name: name.trim() || placeholder,
        mcVersion: mc,
        loader: { kind: loader, version: loader === "vanilla" ? null : loaderVersion || null },
      });
      onCreated?.(inst.id);
      onClose();
      setName("");
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tx("Yeni Instance")}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{tx("İptal")}</button>
          <button className="btn btn-primary" disabled={!mc || busy} onClick={submit}>
            {busy ? tx("Oluşturuluyor…") : tx("Oluştur")}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{tx("Ad")}</span>
        <input value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>

      <div className="field">
        <span>{tx("Mod yükleyici")}</span>
        <div className="segmented">
          {LOADERS.map((l) => (
            <button key={l} className={clsx(loader === l && "active")} onClick={() => setLoader(l)}>
              {LOADER_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span>{tx("Minecraft sürümü")}</span>
          <select value={mc} onChange={(e) => setMc(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{v.id}{v.type !== "release" ? ` (${v.type})` : ""}</option>
            ))}
          </select>
        </label>
        {loader !== "vanilla" && (
          <label className="field">
            <span>{LOADER_LABEL[loader]} {tx("sürümü")}</span>
            <select value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)} disabled={!loaderVersions.length}>
              <option value="">{tx("Önerilen (en güncel kararlı)")}</option>
              {loaderVersions.map((v) => (
                <option key={v.version} value={v.version}>{v.version}{v.stable ? "" : " (beta)"}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="check">
        <input type="checkbox" checked={snapshots} onChange={(e) => setSnapshots(e.target.checked)} />
        {tx("Snapshot sürümlerini göster")}
      </label>

      {noLoaderSupport && <p className="hint warn">{LOADER_LABEL[loader]} {tx("bu sürüm için yükleyici yayınlamamış olabilir.")}</p>}
      {err && <p className="hint error">{err}</p>}
    </Modal>
  );
}
