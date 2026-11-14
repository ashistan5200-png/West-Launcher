import { convertFileSrc } from "@tauri-apps/api/core";
import type { Instance } from "@/lib/types";

/** İsimden deterministik renk — ikonsuz instance'lar için. */
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function InstanceIcon({ instance, size = 48 }: { instance: Instance; size?: number }) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.24) };
  if (instance.icon) {
    return <img className="instance-icon" style={style} src={convertFileSrc(instance.icon)} alt="" draggable={false} />;
  }
  const h = hue(instance.id);
  return (
    <div
      className="instance-icon"
      style={{
        ...style,
        // Mat, düşük doygunluklu ton — paletle uyumlu
        background: `linear-gradient(160deg, hsl(${h} 18% 34%), hsl(${h} 16% 24%))`,
        fontSize: size * 0.42,
      }}
    >
      {instance.name.slice(0, 1).toUpperCase()}
    </div>
  );
}
