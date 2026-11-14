import { useNavigate } from "react-router-dom";
import { Play, Square, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { Instance } from "@/lib/types";
import { LOADER_LABEL, formatRelative } from "@/lib/format";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useHuntRunning } from "@/stores/ashi";
import { InstanceIcon } from "./InstanceIcon";

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
    <motion.div layout className="card instance-card" onClick={() => navigate(`/instance/${instance.id}`)} whileHover={{ y: -2 }}>
      <InstanceIcon instance={instance} size={52} />
      <div className="instance-meta">
        <strong className="truncate">{instance.name}</strong>
        <span className="muted small">
          {LOADER_LABEL[instance.loader.kind]} {instance.mcVersion}
        </span>
        <span className="muted tiny">{formatRelative(instance.lastPlayed)}</span>
      </div>
      <button className={`play-fab ${isRunning ? "stop" : ""}`} onClick={onPlay} aria-label={isRunning ? "Durdur" : "Oyna"}>
        {isLaunching ? <Loader2 size={16} className="spin" /> : isRunning ? <Square size={14} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
    </motion.div>
  );
}
