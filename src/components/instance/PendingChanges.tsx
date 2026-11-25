import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CircleAlert, Clock, Loader2, Undo2 } from "lucide-react";
import { api, isTauri, type LiveOp } from "@/lib/ipc";
import { useInstances } from "@/stores/instances";
import { tx } from "@/lib/i18n";
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
    if (isTauri()) api.livemodsPending(instanceId).then(setOps).catch(() => setOps([]));
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
