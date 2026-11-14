import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useInstances } from "@/stores/instances";
import { STAGE_LABEL } from "@/lib/format";

export function ProgressDock() {
  const progress = useInstances((s) => s.progress);
  const instances = useInstances((s) => s.instances);
  const items = Object.values(progress).filter((p) => p.stage !== "done");

  return (
    <AnimatePresence>
        {items.map((p) => {
          const pct = p.total ? Math.min(100, (p.current / p.total) * 100) : 0;
          const name = instances.find((i) => i.id === p.task)?.name ?? p.task;
          return (
            <motion.div
              key={p.task}
              className="progress-card"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
            >
              <div className="progress-head">
                <Loader2 size={14} className="spin" />
                <strong>{name}</strong>
                <span className="muted">{STAGE_LABEL[p.stage] ?? p.stage}</span>
                <span className="progress-count">
                  {p.total > 1 ? `${p.current}/${p.total}` : ""}
                </span>
              </div>
              <div className="progress-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
            </motion.div>
          );
        })}
    </AnimatePresence>
  );
}
