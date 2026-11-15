import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FlipHorizontal2, Loader2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Modal } from "./Modal";
import { api } from "@/lib/ipc";

interface CropRequest {
  src: string;
  /** genişlik / yükseklik */
  aspect: number;
  round: boolean;
  title: string;
  outWidth: number;
  /** Hareketli GIF'i kırpmadan kullanma seçeneği için */
  isGif: boolean;
  resolve: (r: { dataUrl: string } | "original" | null) => void;
}

const useCropStore = create<{ req: CropRequest | null; set: (r: CropRequest | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

const IMAGES = [{ name: "Görsel", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }];

/**
 * Görsel seçtirir, kırpma penceresini açar ve kırpılmış görseli geçici bir dosyaya yazar.
 * Dönen yol mevcut yükleme komutlarına (westUpload, setInstanceImage) verilebilir. İptalde null.
 */
export async function pickCropped(opts: { aspect: number; round?: boolean; title: string; outWidth?: number }): Promise<string | null> {
  const path = await openDialog({ multiple: false, filters: IMAGES });
  if (typeof path !== "string") return null;
  const src = await api.readImageData(path);
  const r = await new Promise<{ dataUrl: string } | "original" | null>((resolve) =>
    useCropStore.getState().set({ src, aspect: opts.aspect, round: !!opts.round, title: opts.title, outWidth: opts.outWidth ?? 1200, isGif: /\.gif$/i.test(path), resolve }),
  );
  if (r === null) return null;
  if (r === "original") return path;
  return api.saveTempImage(r.dataUrl, "jpg");
}

type View = { zoom: number; x: number; y: number; rot: number; flip: boolean };
const START: View = { zoom: 1, x: 0, y: 0, rot: 0, flip: false };

/** Uygulamada bir kez bulunur (App). */
export function ImageCropperHost() {
  const { req, set } = useCropStore();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [v, setV] = useState<View>(START);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Sahne boyutu: en fazla 520 px genişlik ya da 360 px yükseklik
  const aspect = req?.aspect ?? 1;
  const W = Math.min(520, 360 * aspect);
  const H = W / aspect;

  useEffect(() => {
    setImg(null);
    setV(START);
    if (!req) return;
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = req.src;
  }, [req]);

  // Döndürülmüş görselin kapladığı boyut ve sahneyi tam dolduran taban ölçek
  const turned = v.rot % 180 !== 0;
  const iw = img ? (turned ? img.naturalHeight : img.naturalWidth) : 1;
  const ih = img ? (turned ? img.naturalWidth : img.naturalHeight) : 1;
  const base = Math.max(W / iw, H / ih);
  const scale = base * v.zoom;
  const clamp = (n: View): View => {
    const mx = Math.max(0, (iw * base * n.zoom - W) / 2);
    const my = Math.max(0, (ih * base * n.zoom - H) / 2);
    return { ...n, x: Math.min(mx, Math.max(-mx, n.x)), y: Math.min(my, Math.max(-my, n.y)) };
  };
  const update = (patch: Partial<View>) => setV((cur) => clamp({ ...cur, ...patch }));

  const close = (r: { dataUrl: string } | "original" | null) => {
    req?.resolve(r);
    set(null);
  };

  const done = () => {
    if (!img || !req) return;
    setBusy(true);
    const outW = Math.round(req.outWidth);
    const outH = Math.round(outW / aspect);
    const k = outW / W;
    const c = document.createElement("canvas");
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, outW, outH);
    // CSS'teki dönüşümle aynı sıra: öteleme → döndürme → aynalama → ölçek
    ctx.translate(outW / 2 + v.x * k, outH / 2 + v.y * k);
    ctx.rotate((v.rot * Math.PI) / 180);
    if (v.flip) ctx.scale(-1, 1);
    const s = scale * k;
    ctx.drawImage(img, (-img.naturalWidth * s) / 2, (-img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    const dataUrl = c.toDataURL("image/jpeg", 0.92);
    setBusy(false);
    close({ dataUrl });
  };

  return (
    <Modal open={!!req} onClose={() => close(null)} title={req?.title ?? ""} width={Math.max(W + 40, 420)}
      footer={
        <>
          {req?.isGif && <button className="btn btn-ghost" onClick={() => close("original")} title="Hareketli GIF kırpılınca durağan olur">Kırpmadan kullan (GIF)</button>}
          <span className="grow" />
          <button className="btn btn-ghost" onClick={() => close(null)}>Vazgeç</button>
          <button className="btn btn-primary" disabled={!img || busy} onClick={done}>{busy && <Loader2 size={15} className="spin" />} Uygula</button>
        </>
      }>
      <div
        className={`crop-stage ${req?.round ? "round" : ""}`}
        style={{ width: W, height: H }}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: v.x, y: v.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) update({ x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }); }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => update({ zoom: Math.min(5, Math.max(1, v.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) })}
      >
        {img ? (
          <img src={img.src} alt="" draggable={false}
            style={{ width: img.naturalWidth, height: img.naturalHeight, transform: `translate(-50%, -50%) translate(${v.x}px, ${v.y}px) rotate(${v.rot}deg) scaleX(${v.flip ? -1 : 1}) scale(${scale})` }} />
        ) : <Loader2 className="spin crop-loading" size={22} />}
        <div className="crop-grid" />
        <div className="crop-mask" />
      </div>
      <div className="crop-tools">
        <ZoomOut size={16} className="muted" />
        <input type="range" min={1} max={5} step={0.01} value={v.zoom} onChange={(e) => update({ zoom: Number(e.target.value) })} aria-label="Yakınlaştır" />
        <ZoomIn size={16} className="muted" />
        <span className="vsep" />
        <button className="icon-btn" title="Sola döndür" onClick={() => update({ rot: (v.rot + 270) % 360, x: 0, y: 0 })}><RotateCcw size={16} /></button>
        <button className="icon-btn" title="Sağa döndür" onClick={() => update({ rot: (v.rot + 90) % 360, x: 0, y: 0 })}><RotateCw size={16} /></button>
        <button className={`icon-btn ${v.flip ? "on" : ""}`} title="Aynala" onClick={() => update({ flip: !v.flip })}><FlipHorizontal2 size={16} /></button>
        <button className="btn btn-ghost btn-sm" onClick={() => setV(START)}>Sıfırla</button>
      </div>
      <p className="muted tiny" style={{ textAlign: "center" }}>Sürükleyerek konumlandır, tekerlek ya da çubukla yakınlaştır. Çerçevenin içi görünecek.</p>
    </Modal>
  );
}
