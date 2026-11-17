import { useEffect, useRef } from "react";
import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { tx } from "@/lib/i18n";

interface Ask {
  message: string;
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ ask: Ask | null; set: (a: Ask | null) => void }>((set) => ({ ask: null, set: (ask) => set({ ask }) }));

/**
 * Tarayıcının confirm() penceresi Tauri'de cevabı beklemeden döndüğü için (ve görünüşü
 * uygulamaya uymadığı için) bunun yerine kullanılır. Kullanıcı seçene kadar bekler.
 */
export function askConfirm(message: string, opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  // Silme/kaldırma cümleleri varsayılan olarak tehlikeli sayılır
  const danger = opts.danger ?? /sil|kaldır|engelle|çöp|ayrıl/i.test(message);
  return new Promise((resolve) => {
    useConfirm.getState().ask?.resolve(false);
    useConfirm.getState().set({ message, ...opts, danger, resolve });
  });
}

/** Uygulamada bir kez bulunur (App). */
export function ConfirmHost() {
  const { ask, set } = useConfirm();
  const okRef = useRef<HTMLButtonElement>(null);
  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    set(null);
  };
  useEffect(() => {
    if (!ask) return;
    okRef.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); answer(false); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {ask && (
        <motion.div className="modal-backdrop confirm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => answer(false)}>
          <motion.div className="confirm" role="alertdialog" aria-modal initial={{ opacity: 0, scale: 0.95, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} onMouseDown={(e) => e.stopPropagation()}>
            <span className={`confirm-ico ${ask.danger ? "danger" : ""}`}>{ask.danger ? <AlertTriangle size={20} /> : <HelpCircle size={20} />}</span>
            <div className="confirm-text">
              <strong>{ask.title ?? (ask.danger ? tx("Emin misin?") : tx("Onaylıyor musun?"))}</strong>
              <p>{ask.message}</p>
            </div>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => answer(false)}>{tx("Vazgeç")}</button>
              <button ref={okRef} className={ask.danger ? "btn btn-danger" : "btn btn-primary"} onClick={() => answer(true)}>{ask.confirmLabel ?? tx("Evet")}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
