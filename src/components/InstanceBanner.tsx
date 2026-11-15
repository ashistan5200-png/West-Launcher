import { convertFileSrc } from "@tauri-apps/api/core";
import type { Instance } from "@/lib/types";
import { isTauri } from "@/lib/ipc";
import { CoverArt } from "./CoverArt";

export const coverSeedOf = (i: Instance) => i.coverSeed || i.id;

/** Instance banner'ı: özel görsel varsa o, yoksa seçilen prosedürel manzara. */
export function InstanceBanner({ instance, className, wide }: { instance: Instance; className?: string; wide?: boolean }) {
  if (instance.banner) {
    return <img className={className} src={isTauri() ? convertFileSrc(instance.banner) : instance.banner} alt="" draggable={false} style={{ objectFit: "cover" }} />;
  }
  return <CoverArt seed={coverSeedOf(instance)} className={className} wide={wide} />;
}
