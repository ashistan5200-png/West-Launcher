import { convertFileSrc } from "@tauri-apps/api/core";
import type { Instance } from "@/lib/types";
import { paletteFor } from "./CoverArt";

/** Instance simgesi; özel simge yoksa kapakla aynı paletten piksel dokulu karo. */
export function InstanceIcon({ instance, size = 48 }: { instance: Instance; size?: number }) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.26) };
  if (instance.icon) {
    return <img className="instance-icon" style={style} src={convertFileSrc(instance.icon)} alt="" draggable={false} />;
  }
  const p = paletteFor(instance.id);
  return (
    <div
      className="instance-icon"
      style={{
        ...style,
        background: `linear-gradient(150deg, ${p.sky[1]}, ${p.layers[0]} 55%, ${p.layers[2]})`,
        fontSize: size * 0.44,
      }}
    >
      <span>{instance.name.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}
