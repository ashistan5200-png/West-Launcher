import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, FolderSearch, Loader2, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { Modal } from "./Modal";
import { AshiHead } from "./AshiHead";
import { useOnboarding } from "@/stores/onboarding";
import { useInstances } from "@/stores/instances";
import { api } from "@/lib/ipc";
import type { FoundInstance, LauncherId, ManifestEntry } from "@/lib/types";
import { LOADER_LABEL } from "@/lib/format";
import { tx } from "@/lib/i18n";

export const LAUNCHER_LABEL: Record<LauncherId, string> = {
  modrinth: tx("Modrinth App"), curseforge: tx("CurseForge"), prism: tx("Prism Launcher"), multimc: tx("MultiMC"), official: tx("Minecraft Launcher"),
};

const key = (f: FoundInstance) => `${f.launcher}:${f.gameDir}:${f.name}`;

/** Diğer launcher'lardaki instance'ları bulup tek tıkla West'e kopyalar. Kaynaklara dokunulmaz. */
export function ImportWizard() {
  const { wizardOpen, closeWizard, found, scanning, scan } = useOnboarding();
  const refresh = useInstances((s) => s.refresh);
  const [extra, setExtra] = useState<FoundInstance[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [worlds, setWorlds] = useState(false);
  const [mcList, setMcList] = useState<ManifestEntry[]>([]);
  const [state, setState] = useState<Record<string, "busy" | "done" | string>>({});
  const [running, setRunning] = useState(false);

  const all = useMemo(() => [...(found ?? []), ...extra], [found, extra]);
  useEffect(() => setPicked(new Set(all.map(key))), [all]);
  useEffect(() => {
    if (wizardOpen) api.listMcVersions(false).then(setMcList).catch(() => {});
  }, [wizardOpen]);

  const groups = useMemo(() => {
    const m = new Map<LauncherId, FoundInstance[]>();
    all.forEach((f) => m.set(f.launcher, [...(m.get(f.launcher) ?? []), f]));
    return [...m.entries()];
  }, [all]);

  const totalWorlds = all.filter((f) => picked.has(key(f))).reduce((n, f) => n + f.worldCount, 0);
  const done = Object.values(state).filter((s) => s === "done").length;

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: tx("Launcher veya .minecraft klasörünü seç") });
    if (typeof dir !== "string") return;
    const more = await api.detectLauncherFolder(dir);
    setExtra((e) => [...e, ...more]);
  };

  const run = async () => {
    setRunning(true);
    for (const f of all.filter((x) => picked.has(key(x)))) {
      const k = key(f);
      setState((s) => ({ ...s, [k]: "busy" }));
      try {
        await api.importInstance(f, versions[k] ?? null, worlds);
        setState((s) => ({ ...s, [k]: "done" }));
      } catch (e) {
        setState((s) => ({ ...s, [k]: String(e) }));
      }
    }
    await refresh();
    setRunning(false);
  };

  const finished = done > 0 && !running;
  return (
    <Modal
      open={wizardOpen}
      onClose={() => !running && closeWizard()}
      title={tx("Diğer launcher'lardan aktar")}
      width={620}
      footer={
        <>
          <button className="btn btn-ghost" disabled={running} onClick={pickFolder}><FolderSearch size={15} /> {tx("Klasör seç…")}</button>
          <span className="grow" />
          <button className="btn btn-ghost" disabled={running} onClick={closeWizard}>{finished ? tx("Kapat") : tx("Şimdilik geç")}</button>
          {!finished && (
            <button className="btn btn-primary" disabled={running || picked.size === 0} onClick={run}>
              {running ? <Loader2 size={15} className="spin" /> : null} {picked.size} {tx("instance'ı aktar")}
            </button>
          )}
        </>
      }
    >
      <div className="wizard-intro">
        <AshiHead size={36} />
        <p className="small">
          {scanning && !found
            ? tx("Bilgisayarını tarıyorum…")
            : all.length
              ? tx("Bilgisayarında {0} buldum. Modpack'lerini, modlarını ve ayarlarını West Client'a hemen aktarmak ister misin? Orijinal dosyalarına dokunmam, sadece kopyalarım.", groups.map(([l]) => LAUNCHER_LABEL[l]).join(", "))
              : tx("Bilinen konumlarda başka bir launcher bulamadım. Taşınabilir bir MultiMC/Prism ya da farklı bir .minecraft klasörün varsa \"Klasör seç…\" ile gösterebilirsin.")}
        </p>
        <button className="icon-btn" title={tx("Yeniden tara")} disabled={scanning || running} onClick={() => scan()}><RefreshCw size={15} className={clsx(scanning && "spin")} /></button>
      </div>

      {groups.map(([launcher, items]) => (
        <section key={launcher} className="wizard-group">
          <h4>{LAUNCHER_LABEL[launcher]} <span className="muted tiny">{items.length}</span></h4>
          {items.map((f) => {
            const k = key(f);
            const st = state[k];
            return (
              <label key={k} className={clsx("wizard-row", picked.has(k) && "on")}>
                <input
                  type="checkbox"
                  checked={picked.has(k)}
                  disabled={running || st === "done"}
                  onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(k); else n.delete(k); return n; })}
                />
                <span className="grow">
                  <strong className="truncate">{f.name}</strong>
                  <span className="muted tiny">
                    {LOADER_LABEL[f.loader.kind]} {f.mcVersion ?? "?"} · {f.modCount} {tx("mod ·")} {f.worldCount} {tx("dünya")}{f.hasShaders ? tx(" · shader") : ""}
                  </span>
                  {typeof st === "string" && st !== "busy" && st !== "done" && <span className="hint error">{st}</span>}
                </span>
                {!f.mcVersion && st !== "done" && (
                  <select className="select-sm" value={versions[k] ?? ""} onChange={(e) => setVersions((v) => ({ ...v, [k]: e.target.value }))} title={tx("Sürüm belirlenemedi")}>
                    <option value="">{tx("Sürüm seç")}</option>
                    {mcList.slice(0, 60).map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                  </select>
                )}
                {st === "busy" && <Loader2 size={16} className="spin" />}
                {st === "done" && <Check size={16} className="accent" />}
              </label>
            );
          })}
        </section>
      ))}

      {all.length > 0 && (
        <label className="check">
          <input type="checkbox" checked={worlds} disabled={running} onChange={(e) => setWorlds(e.target.checked)} />
          {tx("Dünyaları da kopyala (")}{totalWorlds} {tx("dünya — büyük olabilir)")}
        </label>
      )}
      {finished && <p className="hint ok">{done} {tx("instance aktarıldı; Kütüphane'de \"↳ kaynak launcher\" etiketiyle görünürler.")}</p>}
    </Modal>
  );
}
