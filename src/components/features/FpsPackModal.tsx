import { useEffect, useState } from "react";
import { Check, Gauge, Loader2, Minus } from "lucide-react";
import clsx from "clsx";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/ipc";
import { errorText } from "@/lib/format";
import type { FpsItem, Instance } from "@/lib/types";
import { tx } from "@/lib/i18n";

/** FPS paketi: bu instance'ın yükleyicisine uygun performans modlarını seçip tek seferde kurar */
export function FpsPackModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const [plan, setPlan] = useState<FpsItem[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api.fpsPlan(instance.id)
      .then((p) => { setPlan(p); setPick(new Set(p.filter((i) => i.status === "install").map((i) => i.slug))); })
      .catch((e) => setError(errorText(e)));
  }, [instance.id]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.fpsInstall(instance.id, [...pick]);
      setDone(tx("{0} mod kuruldu. Oyunu açınca fark hemen hissedilir.", r.installed.length) + (r.warnings.length ? " " + tx("Uyarılar: {0}", r.warnings.join("; ")) : ""));
      setPlan(await api.fpsPlan(instance.id));
      setPick(new Set());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={tx("FPS paketi")} onClose={onClose} width={520}>
      <div className="feat">
        <p className="feat-lead">{tx("{0} için seçtiğim performans modları. Hepsi birbiriyle uyumlu; gerekirse kütüphaneleri de kurarım.", instance.name)}</p>
        {error && <p className="feat-error">{error}</p>}
        {!plan && !error && <p className="feat-lead"><Loader2 size={14} className="spin" /> {tx("Uyumlu sürümler kontrol ediliyor…")}</p>}
        {plan && (
          <ul className="feat-list">
            {plan.map((i) => {
              const on = pick.has(i.slug);
              return (
                <li key={i.slug} className={clsx("feat-item", i.status !== "install" && "off")}>
                  <button
                    className={clsx("feat-check", on && "on", i.status === "installed" && "done")}
                    disabled={i.status !== "install" || busy}
                    aria-pressed={on}
                    onClick={() => setPick((p) => { const n = new Set(p); if (n.has(i.slug)) n.delete(i.slug); else n.add(i.slug); return n; })}
                  >
                    {i.status === "installed" ? <Check size={13} /> : i.status === "skip" ? <Minus size={13} /> : on ? <Check size={13} /> : null}
                  </button>
                  <span className="grow">
                    <strong>{i.title}</strong>
                    <span>{i.status === "installed" ? tx("Zaten kurulu") : i.note ?? i.why}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {done && <p className="feat-done"><Check size={15} /> {done}</p>}
        <div className="feat-row">
          <button className="btn btn-primary btn-lg grow" disabled={busy || pick.size === 0} onClick={() => void run()}>
            {busy ? <Loader2 size={16} className="spin" /> : <Gauge size={16} />} {busy ? tx("Kuruluyor…") : pick.size ? tx("{0} modu kur", pick.size) : tx("Kurulacak bir şey yok")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
