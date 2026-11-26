import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Gauge } from "lucide-react";
import clsx from "clsx";
import { api, isTauri } from "@/lib/ipc";
import type { Instance, PerfReport } from "@/lib/types";
import { FpsPackModal } from "./FpsPackModal";
import { tx } from "@/lib/i18n";

/**
 * "Neden kasıyor?": son oturumun ölçümleri (oyundan gelir) ve yorumu. Oyun bir kez dünyada oynanmadan görünmez.
 * Eylemler: FPS paketi, bellek ayarı (instance ayarlarına gider).
 */
export function PerfCard({ instance, onOpenSettings, refreshKey }: { instance: Instance; onOpenSettings: () => void; refreshKey?: unknown }) {
  const [rep, setRep] = useState<PerfReport | null>(null);
  const [open, setOpen] = useState(false);
  const [fps, setFps] = useState(false);
  useEffect(() => {
    if (isTauri()) api.perfReport(instance.id).then(setRep).catch(() => setRep(null));
  }, [instance.id, refreshKey]);
  const last = rep?.sessions.filter((s) => s.inWorldSecs >= 20).at(-1);
  if (!rep || !last) return null;
  const bad = rep.findings.filter((f) => f.tone !== "ok").length;
  const worst = rep.findings.some((f) => f.tone === "bad") ? "bad" : bad ? "warn" : "ok";

  return (
    <section className={clsx("perf", worst)}>
      <button className="perf-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="perf-icon">{worst === "ok" ? <CheckCircle2 size={16} /> : worst === "bad" ? <AlertTriangle size={16} /> : <Activity size={16} />}</span>
        <span className="grow">
          <strong>{worst === "ok" ? tx("Son oturum akıcıydı") : tx("Neden kasıyor? {0} bulgu", bad)}</strong>
          <span>{tx("Ortalama {0} FPS · en kötü anlarda {1} · {2} takılma", Math.round(last.fpsAvg), Math.round(last.fpsLow1), last.stutters)}</span>
        </span>
        <span className="perf-spark" aria-hidden>
          {rep.sessions.slice(-8).map((s, i) => (
            <i key={i} style={{ height: `${Math.max(8, Math.min(100, (s.fpsAvg / 160) * 100))}%` }} />
          ))}
        </span>
        <ChevronDown size={16} className={clsx("perf-chev", open && "open")} />
      </button>
      {open && (
        <ul className="perf-list">
          {rep.findings.map((f) => (
            <li key={f.title} className={f.tone}>
              <div className="grow">
                <strong>{f.title}</strong>
                <span>{f.text}</span>
              </div>
              {f.action === "fps-pack" && <button className="btn btn-ghost btn-sm" onClick={() => setFps(true)}><Gauge size={14} /> {tx("FPS paketi")}</button>}
              {f.action === "memory" && <button className="btn btn-ghost btn-sm" onClick={onOpenSettings}>{tx("Belleği ayarla")}</button>}
            </li>
          ))}
          <li className="perf-meta">{tx("Bellek tepe noktası %{0} ({1} MB ayrılmış) · görüş mesafesi {2} · {3} mod", Math.round(last.memPeakPct), last.memMaxMb, last.renderDistance || "?", last.mods)}</li>
        </ul>
      )}
      {fps && <FpsPackModal instance={instance} onClose={() => setFps(false)} />}
    </section>
  );
}
