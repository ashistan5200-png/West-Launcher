import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { useInstances } from "@/stores/instances";
import { tx } from "@/lib/i18n";

export function ErrorToast() {
  const { error, clearError } = useInstances();
  return (
    <AnimatePresence>
      {error && (
        <motion.div className="toast toast-error" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <AlertTriangle size={16} />
          <pre>{error}</pre>
          <button className="icon-btn" onClick={clearError} aria-label={tx("Kapat")}>
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
