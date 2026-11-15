import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, Check, Minus, Search, X } from "lucide-react";
import { AshiAvatar } from "./AshiAvatar";
import { useAshi, type HuntView } from "@/stores/ashi";
import { useInstances } from "@/stores/instances";
import { ashiLines, type AshiMood } from "@/lib/ashi";
import { formatDuration } from "@/lib/format";

/** Sağ alttaki Ashi kartları: çökme sonrası teklif + süren/biten avlar. */
export function AshiDock() {
  const { offer, hunts } = useAshi();
  const list = Object.values(hunts);

  return (
    <AnimatePresence initial={false}>
      {offer && !hunts[offer.instanceId] && <OfferCard key={`offer-${offer.instanceId}`} />}
      {list.map((h) => (
        <HuntCard key={`hunt-${h.instanceId}`} hunt={h} />
      ))}
    </AnimatePresence>
  );
}

const cardMotion = {
  layout: true,
  initial: { opacity: 0, y: 16, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 10, scale: 0.98 },
} as const;

function OfferCard() {
  const { offer, dismissOffer, openConfirm } = useAshi();
  if (!offer) return null;
  return (
    <motion.div className="ashi-card" {...cardMotion} role="alertdialog" aria-label="Ashi">
      <div className="ashi-stage">
        <AshiAvatar mood="wave" width={96} height={120} />
      </div>
      <div className="ashi-body">
        <div className="ashi-head">
          <span className="ashi-name">Ashi</span>
          <span className="ashi-role">Suçlu Avcısı</span>
          <button className="icon-btn ashi-x" onClick={dismissOffer} aria-label="Kapat">
            <X size={14} />
          </button>
        </div>
        <p className="ashi-bubble">{offer.line}</p>
        <p className="muted tiny">Otomatik Suçlu Avcısı'nı çalıştırmak istiyor musun?</p>
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={() => openConfirm(offer.instanceId, offer.name)}>
            <Search size={14} /> Çalıştır
          </button>
          <button className="btn btn-ghost btn-sm" onClick={dismissOffer}>Şimdi değil</button>
        </div>
      </div>
    </motion.div>
  );
}

/** Tepki animasyonu (bonk / el sallama) kısa süre oynar, sonra ana ruh haline döner. */
function useEffectiveMood(h: HuntView): AshiMood {
  const [, tick] = useState(0);
  const reacting = h.reactMood && Date.now() - h.reactAt < 2400;
  useEffect(() => {
    if (!reacting) return;
    const t = window.setTimeout(() => tick((n) => n + 1), 2400 - (Date.now() - h.reactAt));
    return () => window.clearTimeout(t);
  }, [reacting, h.reactAt]);
  return reacting && h.status === "running" ? h.reactMood! : h.mood;
}

function useElapsed(since: number, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, [running]);
  return Math.floor((now - since) / 1000);
}

function HuntCard({ hunt: h }: { hunt: HuntView }) {
  const { cancel, disable, close } = useAshi();
  const name = useInstances((s) => s.instances.find((i) => i.id === h.instanceId)?.name ?? h.instanceId);
  const mood = useEffectiveMood(h);
  const running = h.status === "running";
  const elapsed = useElapsed(h.startedAt, running);
  const [collapsed, setCollapsed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const pct = h.status === "done" ? 100 : Math.min(96, (h.round / Math.max(1, h.maxRounds)) * 100);

  return (
    <motion.div className={`ashi-card ${collapsed ? "collapsed" : ""}`} {...cardMotion} aria-live="polite">
      <div className="ashi-stage">
        <AshiAvatar mood={mood} width={collapsed ? 56 : 96} height={collapsed ? 70 : 120} />
      </div>
      <div className="ashi-body">
        <div className="ashi-head">
          <span className="ashi-name">Ashi</span>
          <span className="ashi-role truncate">{name}</span>
          {running ? (
            <button className="icon-btn ashi-x" onClick={() => setCollapsed((c) => !c)} aria-label="Küçült">
              <Minus size={14} />
            </button>
          ) : (
            <button className="icon-btn ashi-x" onClick={() => close(h.instanceId)} aria-label="Kapat">
              <X size={14} />
            </button>
          )}
        </div>

        {!collapsed && <p className="ashi-bubble">{h.line}</p>}
        {!collapsed && running && h.reaction && <p className="ashi-reaction">{h.reaction}</p>}

        {running && (
          <>
            <div className="ashi-stats">
              <span>Tur {Math.min(h.round + 1, h.maxRounds)} / ~{h.maxRounds}</span>
              <span>{h.suspects} şüpheli</span>
              <span>{formatDuration(elapsed)}</span>
            </div>
            <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
            {!collapsed && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={stopping}
                onClick={async () => { setStopping(true); await cancel(h.instanceId).catch(() => setStopping(false)); }}
              >
                {stopping ? "Durduruluyor…" : "Avı durdur"}
              </button>
            )}
          </>
        )}

        {h.status === "done" && h.verdict?.kind === "culprit" && (() => {
          const mods = h.verdict.mods;
          const lib = mods.some((m) => m.library);
          const deps = [...new Set(mods.flatMap((m) => m.dependents))];
          return (
            <>
              <ModList mods={mods} highlight />
              {lib && (
                <p className="muted tiny">
                  Bu bir kütüphane{deps.length > 0 && <> ve şu modlar ona bağlı: <strong>{deps.slice(0, 5).join(", ")}</strong>{deps.length > 5 && ` +${deps.length - 5}`}</>}.
                  Kapatmak yerine İçerik sekmesinden güncellemeyi dene.
                </p>
              )}
              <div className="row">
                {!lib && (
                  <button className="btn btn-primary btn-sm" onClick={() => disable(h.instanceId, mods.map((m) => m.file))}>
                    <Ban size={14} /> Devre dışı bırak
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => close(h.instanceId)}>{lib ? "Tamam" : "Dokunma"}</button>
              </div>
              {!lib && <p className="muted tiny">Mod silinmez; dosya <code>.disabled</code> olur, istediğin zaman geri açabilirsin.</p>}
            </>
          );
        })()}

        {h.status === "done" && h.verdict?.kind === "dependency" && (
          <pre className="ashi-error">{h.verdict.message}</pre>
        )}

        {h.status === "done" && h.verdict?.kind === "combination" && (
          <>
            <ModList mods={h.verdict.suspects.slice(0, 6)} />
            {h.verdict.suspects.length > 6 && <p className="muted tiny">+{h.verdict.suspects.length - 6} şüpheli daha</p>}
            <p className="muted tiny">Bu modları tek tek güncellemeyi veya birini kaldırıp denemeyi öneririm.</p>
          </>
        )}

        {(h.status === "cancelled" || h.status === "error") && (
          <>
            {h.message && <pre className="ashi-error">{h.message}</pre>}
            <p className="muted tiny"><Check size={12} /> {ashiLines.restored}</p>
          </>
        )}
      </div>
    </motion.div>
  );
}

function ModList({ mods, highlight = false }: { mods: { file: string; name: string }[]; highlight?: boolean }) {
  return (
    <ul className={`ashi-mods ${highlight ? "highlight" : ""}`}>
      {mods.map((m) => (
        <li key={m.file}>
          <strong className="truncate">{m.name}</strong>
          <span className="muted tiny truncate">{m.file}</span>
        </li>
      ))}
    </ul>
  );
}
