import { useEffect, useRef } from "react";
import { useAshi } from "@/stores/ashi";

/**
 * AshiWest skininin yüzünden (8×8 yüz + şapka katmanı) üretilen piksel-art
 * avatar. three.js yüklemeden çizildiği için kenar çubuğu ve sohbet
 * balonlarında maliyetsizdir.
 */
export function AshiHead({ size = 28, className = "" }: { size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const skin = useAshi((s) => s.skin.dataUrl);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 8, 8);
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8); // yüz
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8); // şapka/saç katmanı
    };
    img.src = skin;
  }, [skin]);

  return <canvas ref={ref} width={8} height={8} className={`ashi-head ${className}`} style={{ width: size, height: size }} aria-label="Ashi" />;
}
