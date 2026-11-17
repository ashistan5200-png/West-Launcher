import { useNavigate } from "react-router-dom";
import { Play, Square, Loader2, Clock } from "lucide-react";
import { motion } from "framer-motion";
import type { Instance } from "@/lib/types";
import { LOADER_LABEL, formatDuration, formatRelative } from "@/lib/format";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useHuntRunning } from "@/stores/ashi";
import { InstanceIcon } from "./InstanceIcon";
import { InstanceBanner } from "./InstanceBanner";
import { tx } from "@/lib/i18n";

/** Kapak görselli instance kartı; üzerine gelince oyna düğmesi belirir. */
export function InstanceCard({ instance }: { instance: Instance }) {
  const navigate = useNavigate();
  const { running, launching, launch, kill } = useInstances();
  const offlineName = useSettings((s) => s.offlineName);
  const isRunning = running[instance.id] !== undefined;
  const isLaunching = !!launching[instance.id];
  const hunting = useHuntRunning(instance.id);

  const onPlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) void kill(instance.id);
    else if (!isLaunching && !hunting) void launch(instance.id, offlineName);
  };

  return (
    <motion.div layout className={`icard ${isRunning ? "running" : ""}`} onClick={() => navigate(`/instance/${instance.id}`)} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
      <div className="icard-cover">
        <InstanceBanner instance={instance} className="icard-art" />
        <span className={`loader-badge ${instance.loader.kind}`}>{LOADER_LABEL[instance.loader.kind]}</span>
        {isRunning && <span className="live-badge"><span /> {tx("Oynanıyor")}</span>}
      </div>
      <div className="icard-body">
        <InstanceIcon instance={instance} size={46} />
        <div className="icard-meta">
          <strong className="truncate">{instance.name}</strong>
          <span className="muted small">{instance.mcVersion} · {formatRelative(instance.lastPlayed)}</span>
          {instance.totalPlaySecs > 0 && <span className="muted tiny"><Clock size={11} /> {formatDuration(instance.totalPlaySecs)}</span>}
        </div>
      </div>
      <button className={`icard-play ${isRunning ? "stop" : ""}`} onClick={onPlay} aria-label={isRunning ? tx("Durdur") : tx("Oyna")}>
        {isLaunching ? <Loader2 size={18} className="spin" /> : isRunning ? <Square size={15} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
    </motion.div>
  );
}
