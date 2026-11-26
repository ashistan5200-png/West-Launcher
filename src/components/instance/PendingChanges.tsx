import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, CircleAlert, Clock, History, Loader2, Undo2 } from "lucide-react";
import { api, isTauri, type LiveOp } from "@/lib/ipc";
import { useInstances } from "@/stores/instances";
import { locale, tx } from "@/lib/i18n";
import { askConfirm } from "@/components/ConfirmDialog";
import { errorText } from "@/lib/format";

/**
 * Oyun içi Mod Merkezi'nde biriken değişiklikler. Oyun kapalıyken buradan uygulanır, geri alınır;
 * yeni mod düzeniyle oyun açılamadıysa sebebi gösterilir ve "Tekrar dene" sunulur.
 */
export function PendingChanges({ instanceId, onApplied }: { instanceId: string; onApplied: () => void }) {
  const [ops, setOps] = useState<LiveOp[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useInstances((s) => instanceId in s.running);

  const load = useCallback(() => {
    if (isTauri()) api.livemodsPending(instanceId).then((o) => setOps(Array.isArray(o) ? o : [])).catch(() => setOps([]));
  }, [instanceId]);

  // Oyun kapanınca/açılınca bekleyenler değişir
  useEffect(load, [load, running]);
  useEffect(() => {
    if (!isTauri()) return;
    const un = listen("game-exit", () => window.setTimeout(load, 800));
    return () => void un.then((f) => f());
  }, [load]);

  if (!ops.length) return null;
  const failed = ops.find((o) => o.failed)?.failed;

  const run = async (key: string, fn: () => Promise<LiveOp[] | string[]>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (key === "apply") {
        if (r.length) setError((r as string[]).join(" · "));
        onApplied();
        load();
      } else setOps(r as LiveOp[]);
      if (key.startsWith("undo")) onApplied();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={failed ? "pending-box failed" : "pending-box"}>
      <div className="pending-head">
        {failed ? <CircleAlert size={16} /> : <Clock size={16} />}
        <div className="pending-title">
          <strong>{failed ? tx("Oyun bu değişikliklerle açılamadı") : tx("{0} değişiklik bekliyor", ops.length)}</strong>
          <span className="muted small">
            {failed
              ? tx("Sebep: {0}. Sorunlu olanı geri al, sonra tekrar dene.", failed)
              : running
                ? tx("Oyunun içinden uygula: Mod Merkezi (H) → Uygula. Oyun kapanmadan geçilir.")
                : tx("Oyun içi Mod Merkezi'nde yapıldı. Bir sonraki açılışta ya da şimdi uygulanır.")}
          </span>
        </div>
        {failed ? (
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("retry", () => api.livemodsRetry(instanceId))}>
            {busy === "retry" ? <Loader2 size={14} className="spin" /> : null} {tx("Tekrar dene")}
          </button>
        ) : (
          !running && (
            <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void run("apply", () => api.livemodsApply(instanceId))}>
              {busy === "apply" ? <Loader2 size={14} className="spin" /> : null} {tx("Şimdi uygula")}
            </button>
          )
        )}
      </div>
      <ul className="pending-list">
        {ops.map((o, i) => (
          <li key={`${o.at}-${i}`} className={o.failed ? "bad" : undefined}>
            <span className="truncate">{o.label}</span>
            {o.failed && <span className="chip chip-danger">{tx("açılamadı")}</span>}
            <button className="btn-link small" disabled={!!busy} onClick={() => void run(`undo${i}`, () => api.livemodsUndo(instanceId, i))}>
              {busy === `undo${i}` ? <Loader2 size={13} className="spin" /> : <Undo2 size={13} />} {tx("Geri al")}
            </button>
          </li>
        ))}
      </ul>
      {error && <div className="banner banner-error">{error}</div>}
    </div>
  );
}

interface RestorePointBrief { id: string; at: number; label: string; mods: number; packs: number }

/**
 * Önceki düzenler: her uygulamadan önce kaydedilen geri dönüş noktaları. Oyun kapalıyken buradan,
 * açıkken oyunun içinden (Mod Merkezi → Bekleyenler) dönülür. Hiçbir dosya silinmez.
 */
export function RestorePoints({ instanceId, onRestored }: { instanceId: string; onRestored: () => void }) {
  const [points, setPoints] = useState<RestorePointBrief[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useInstances((s) => instanceId in s.running);
  const load = useCallback(() => {
    if (isTauri()) api.livemodsPoints(instanceId).then((p) => setPoints(Array.isArray(p) ? (p as RestorePointBrief[]) : [])).catch(() => setPoints([]));
  }, [instanceId]);
  useEffect(load, [load, running]);

  if (!points.length) return null;
  const fmt = (at: number) => new Date(at * 1000).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const restore = async (p: RestorePointBrief) => {
    if (!(await askConfirm(tx("{0} tarihindeki mod düzenine dönülsün mü? Sonradan eklenen modlar silinmez, kapatılır.", fmt(p.at)), { danger: false, confirmLabel: tx("Geri dön") }))) return;
    setBusy(p.id);
    setError(null);
    try {
      await api.livemodsRestore(instanceId, p.id);
      onRestored();
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="restore-box">
      <button className="restore-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <History size={15} /> {tx("Önceki düzenler")} <span className="muted small">{points.length}</span>
        <ChevronDown size={14} className={open ? "rot" : undefined} />
      </button>
      {open && (
        <ul className="pending-list">
          {points.map((p) => (
            <li key={p.id}>
              <span className="restore-when">{fmt(p.at)}</span>
              <span className="truncate muted">{tx("{0} mod · sonra: {1}", p.mods, p.label)}</span>
              <button className="btn-link small" disabled={!!busy || running} title={running ? tx("Oyun açıkken oyunun içinden dön: Mod Merkezi → Bekleyenler") : undefined} onClick={() => void restore(p)}>
                {busy === p.id ? <Loader2 size={13} className="spin" /> : <Undo2 size={13} />} {tx("Bu düzene dön")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="banner banner-error">{error}</div>}
    </div>
  );
}
