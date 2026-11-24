import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AshiAvatar } from "./AshiAvatar";
import type { AshiMood } from "@/lib/ashi";
import { tx } from "@/lib/i18n";

/** Rehber adımı: `target` → [data-guide="..."] öğesi (yoksa ekranın ortası) */
export interface GuideStep {
  target?: string;
  title: string;
  text: string;
  mood?: AshiMood;
  /** Adım açılınca çalışır (ör. ilgili aracı seç) */
  enter?: () => void;
}

const AW = 92;
const AH = 116;
const BW = 300;

function place(target?: string) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const el = target ? document.querySelector<HTMLElement>(`[data-guide="${target}"]`) : null;
  if (!el) return { x: vw / 2 - (AW + BW) / 2, y: vh / 2 - AH / 2 - 30, rect: null as DOMRect | null };
  const r = el.getBoundingClientRect();
  const w = AW + BW + 16;
  // Önce sağ, sonra sol, olmazsa altına/üstüne
  let x = r.right + 14;
  if (x + w > vw - 8) x = r.left - w - 14;
  let y = r.top + r.height / 2 - AH / 2;
  if (x < 8) {
    x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    y = r.bottom + 14 + AH + 120 < vh ? r.bottom + 14 : r.top - AH - 130;
  }
  return { x, y: Math.min(Math.max(8, y), vh - AH - 150), rect: r };
}

/** Rehberin bir kez kendiliğinden açılması için: daha önce gösterilmediyse true döner ve işaretler */
export function firstTime(key: string): boolean {
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Ashi'nin anlattığı adım adım rehber: hedef öğeyi aydınlatır, yanına uçup konuşma balonuyla
 * ne işe yaradığını ve nasıl kullanıldığını anlatır. Ok tuşları ve Esc ile de gezilir.
 */
export function AshiGuide({ steps, open, onClose, label }: { steps: GuideStep[]; open: boolean; onClose: () => void; label: string }) {
  const [i, setI] = useState(0);
  const [pos, setPos] = useState(() => place());
  const step = steps[Math.min(i, steps.length - 1)];

  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => { if (open) step.enter?.(); }, [open, i]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => setPos(place(step.target));
    const t = window.setTimeout(update, 60); // enter() düzeni değiştirmiş olabilir
    update();
    window.addEventListener("resize", update);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", update); };
  }, [open, i, step.target]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.stopImmediatePropagation(); e.preventDefault(); if (i < steps.length - 1) setI(i + 1); else onClose(); }
      else if (e.key === "ArrowLeft") { e.stopImmediatePropagation(); setI((n) => Math.max(0, n - 1)); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, i, steps.length, onClose]);

  if (!open) return null;
  const last = i === steps.length - 1;

  return createPortal(
    <div className="guide-layer" role="dialog" aria-label={label}>
      <AnimatePresence>
        {pos.rect ? (
          <motion.div
            key="spot"
            className="tour-spot"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, left: pos.rect.left - 6, top: pos.rect.top - 6, width: pos.rect.width + 12, height: pos.rect.height + 12 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 170, damping: 24 }}
          />
        ) : (
          <motion.div key="dim" className="tour-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        )}
      </AnimatePresence>
      <motion.div
        className="tour-ashi"
        initial={{ x: window.innerWidth + 40, y: -AH, rotate: -10 }}
        animate={{ x: pos.x, y: pos.y, rotate: 0 }}
        transition={{ type: "spring", stiffness: 60, damping: 14 }}
      >
        <div className="tour-float"><AshiAvatar mood={step.mood ?? "idle"} width={AW} height={AH} /></div>
        <AnimatePresence mode="wait">
          <motion.div
            key={i}
            className="tour-bubble guide-bubble"
            initial={{ opacity: 0, x: -8, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          >
            <div className="tour-head">
              <strong>{step.title}</strong>
              <span className="tour-dots">{steps.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}</span>
            </div>
            <p>{step.text}</p>
            <div className="tour-actions">
              {i > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setI(i - 1)}>{tx("Geri")}</button>}
              <button className="btn btn-primary btn-sm" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? tx("Hadi başlayalım") : tx("Devam et")}</button>
              {!last && <button className="btn-link" onClick={onClose}>{tx("Anladım, geç")}</button>}
              <span className="muted tiny guide-count">{i + 1}/{steps.length}</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body,
  );
}
