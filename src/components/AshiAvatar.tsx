import { lazy, Suspense } from "react";
import type { AshiMood } from "@/lib/ashi";

/**
 * three.js + skinview3d ~600 KB. Launcher açılışını hafif tutmak için Ashi'nin
 * 3D modeli yalnızca ilk kez görüneceği an yüklenir (ayrı chunk).
 */
const Ashi3D = lazy(() => import("./Ashi3D"));

interface Props {
  mood: AshiMood;
  facing?: number;
  width?: number;
  height?: number;
  interactive?: boolean;
}

export function AshiAvatar(props: Props) {
  const { width = 120, height = 150 } = props;
  return (
    <Suspense fallback={<div className="ashi-canvas" style={{ width, height }} />}>
      <Ashi3D {...props} />
    </Suspense>
  );
}
