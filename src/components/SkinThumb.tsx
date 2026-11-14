import { memo, useEffect, useRef } from "react";

/**
 * Skinin önden 2D görünümü (16×32 mantıksal piksel). three.js gerektirmez;
 * arşiv galerisindeki onlarca küçük resim için ucuzdur.
 */
export const SkinThumb = memo(function SkinThumb({ dataUrl, slim, height = 96 }: { dataUrl: string; slim: boolean; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const ctx = ref.current?.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 16, 32);
      const modern = img.height === 64;
      const aw = slim ? 3 : 4;
      const d = (sx: number, sy: number, w: number, h: number, dx: number, dy: number) => ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h);
      // iç katman
      d(8, 8, 8, 8, 4, 0); // kafa
      d(20, 20, 8, 12, 4, 8); // gövde
      d(44, 20, aw, 12, 4 - aw, 8); // sağ kol (izleyicinin solu)
      d(4, 20, 4, 12, 4, 20); // sağ bacak
      if (modern) {
        d(36, 52, aw, 12, 12, 8); // sol kol
        d(20, 52, 4, 12, 8, 20); // sol bacak
      } else {
        d(44, 20, aw, 12, 12, 8);
        d(4, 20, 4, 12, 8, 20);
      }
      // dış katman (şapka, ceket, kollar, pantolon)
      d(40, 8, 8, 8, 4, 0);
      if (modern) {
        d(20, 36, 8, 12, 4, 8);
        d(44, 36, aw, 12, 4 - aw, 8);
        d(52, 52, aw, 12, 12, 8);
        d(4, 36, 4, 12, 4, 20);
        d(4, 52, 4, 12, 8, 20);
      }
    };
    img.src = dataUrl;
  }, [dataUrl, slim]);

  return <canvas ref={ref} width={16} height={32} className="skin-thumb" style={{ height, width: height / 2 }} />;
});
