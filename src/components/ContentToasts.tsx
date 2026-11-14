import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useContent } from "@/stores/content";

/** Kurulum sonuçları — sağ alttaki dock içinde, kısa süre görünür. */
export function ContentToasts() {
  const { toasts, dismissToast } = useContent();
  return (
    <AnimatePresence initial={false}>
      {toasts.map((t) => (
        <motion.div
          key={t.id}
          layout
          className={`mini-toast ${t.tone}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, x: 12 }}
        >
          {t.tone === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span className="grow">{t.text}</span>
          <button className="icon-btn" onClick={() => dismissToast(t.id)} aria-label="Kapat"><X size={13} /></button>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
