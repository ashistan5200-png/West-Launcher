import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Copy, Crop, Download, Loader2, Pencil, RotateCcw, Save, SlidersHorizontal, Type, Undo2, X } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/ipc";
import type { Screenshot } from "@/lib/types";
import { canvasToBase64, NEUTRAL, PRESETS, render, type Adjust, type Annotation, type EditState, type Rect } from "@/lib/imageEdit";
import { useGallery } from "@/stores/gallery";
import { tx } from "@/lib/i18n";

type Tool = "adjust" | "crop" | "draw" | "text";
const ASPECTS: { label: string; r: number | null }[] = [
  { label: tx("Serbest"), r: null }, { label: "16:9", r: 16 / 9 }, { label: "4:3", r: 4 / 3 }, { label: "1:1", r: 1 }, { label: "9:16", r: 9 / 16 },
];
const COLORS = ["#ffffff", "#7fa7c9", "#79a88a", "#c2a878", "#c08573", "#a08cb8", "#111214"];
const SLIDERS: { key: keyof Omit<Adjust, "mode">; label: string; min: number }[] = [
  { key: "brightness", label: tx("Parlaklık"), min: -100 },
  { key: "contrast", label: tx("Kontrast"), min: -100 },
  { key: "saturation", label: tx("Doygunluk"), min: -100 },
  { key: "warmth", label: tx("Sıcaklık"), min: -100 },
  { key: "vignette", label: tx("Vinyet"), min: 0 },
];
const MAX_W = 1000;
const MAX_H = 600;

export function ScreenshotEditor({ shot }: { shot: Screenshot }) {
  const { edit, added, flash } = useGallery();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("adjust");
  const [st, setSt] = useState<EditState>({ adjust: NEUTRAL, annotations: [], crop: null, outWidth: null });
  const [aspect, setAspect] = useState<number | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(8);
  const [text, setText] = useState(tx("West Client"));
  const [busy, setBusy] = useState<string | null>(null);
  const [draftCrop, setDraftCrop] = useState<Rect | null>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Orijinali ikili olarak al → blob URL (tuval kirlenmez, getImageData çalışır)
  useEffect(() => {
    let url = "";
    api.readScreenshot(shot.path).then((buf) => {
      url = URL.createObjectURL(new Blob([buf]));
      const i = new Image();
      i.onload = () => setImg(i);
      i.src = url;
    }).catch((e) => flash(String(e), "error"));
    return () => URL.revokeObjectURL(url);
  }, [shot.path, flash]);

  const scale = img ? Math.min(1, MAX_W / img.width, MAX_H / img.height) : 1;
  const region: Rect = useMemo(
    () => (tool !== "crop" && st.crop) || { x: 0, y: 0, w: img?.width ?? 1, h: img?.height ?? 1 },
    [tool, st.crop, img],
  );

  // Önizleme: aynı hat, küçük ölçek; rAF ile kare başına en fazla bir kez
  const raf = useRef(0);
  useEffect(() => {
    if (!img) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = view.current;
      if (!c) return;
      const out = render(img, st, scale, tool === "crop");
      c.width = out.width;
      c.height = out.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(out, 0, 0);
      const r = tool === "crop" ? draftCrop ?? st.crop : null;
      if (r) {
        // Kırpma dışını karart, çerçeve + üçte bir kılavuzları
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.rect(0, 0, c.width, c.height);
        ctx.rect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
        ctx.fill("evenodd");
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        for (let k = 1; k < 3; k++) {
          ctx.beginPath();
          ctx.moveTo((r.x + (r.w * k) / 3) * scale, r.y * scale);
          ctx.lineTo((r.x + (r.w * k) / 3) * scale, (r.y + r.h) * scale);
          ctx.moveTo(r.x * scale, (r.y + (r.h * k) / 3) * scale);
          ctx.lineTo((r.x + r.w) * scale, (r.y + (r.h * k) / 3) * scale);
          ctx.stroke();
        }
      }
    });
  }, [img, st, scale, tool, draftCrop]);

  /** Ekran noktası → orijinal görüntü pikseli */
  const toImage = useCallback((e: React.PointerEvent): [number, number] => {
    const rect = view.current!.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    if (tool === "crop") return [fx * (img?.width ?? 1), fy * (img?.height ?? 1)];
    return [region.x + fx * region.w, region.y + fy * region.h];
  }, [tool, img, region]);

  const onDown = (e: React.PointerEvent) => {
    if (!img) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const [x, y] = toImage(e);
    if (tool === "crop") drag.current = { x, y };
    if (tool === "draw") setSt((s) => ({ ...s, annotations: [...s.annotations, { type: "pen", color, size, points: [[x, y]] }] }));
    if (tool === "text" && text.trim()) {
      setSt((s) => ({ ...s, annotations: [...s.annotations, { type: "text", color, size: size * 6, x, y, text: text.trim() }] }));
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!img || !(e.buttons & 1)) return;
    const [x, y] = toImage(e);
    if (tool === "crop" && drag.current) {
      const o = drag.current;
      let w = Math.abs(x - o.x);
      let h = Math.abs(y - o.y);
      if (aspect) h = w / aspect;
      const rx = Math.max(0, x < o.x ? o.x - w : o.x);
      const ry = Math.max(0, y < o.y ? o.y - h : o.y);
      w = Math.min(w, img.width - rx);
      h = Math.min(h, img.height - ry);
      setDraftCrop({ x: rx, y: ry, w, h });
    }
    if (tool === "draw") {
      setSt((s) => {
        const list = [...s.annotations];
        const last = list[list.length - 1] as Extract<Annotation, { type: "pen" }>;
        if (!last || last.type !== "pen") return s;
        const [px, py] = last.points[last.points.length - 1];
        if (Math.hypot(x - px, y - py) < 2 / scale) return s; // nokta seyreltme
        list[list.length - 1] = { ...last, points: [...last.points, [x, y]] };
        return { ...s, annotations: list };
      });
    }
  };

  const onUp = () => {
    if (tool === "crop" && draftCrop && draftCrop.w > 8 && draftCrop.h > 8) {
      setSt((s) => ({ ...s, crop: { x: Math.round(draftCrop.x), y: Math.round(draftCrop.y), w: Math.round(draftCrop.w), h: Math.round(draftCrop.h) } }));
    }
    drag.current = null;
    setDraftCrop(null);
  };

  const setAdjust = (patch: Partial<Adjust>) => setSt((s) => ({ ...s, adjust: { ...s.adjust, ...patch } }));
  const exportCanvas = () => render(img!, st, 1);
  const outW = st.outWidth ?? Math.round((st.crop?.w ?? img?.width ?? 0));
  const outH = Math.round(outW * ((st.crop?.h ?? img?.height ?? 1) / (st.crop?.w ?? img?.width ?? 1)));

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      flash(String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div className="editor-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="editor" initial={{ scale: 0.98, y: 8 }} animate={{ scale: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
        <header className="editor-head">
          <strong className="truncate">{shot.file}</strong>
          <span className="muted tiny">{shot.instanceName}</span>
          <div className="row" style={{ marginLeft: "auto" }}>
            <button className="icon-btn" title={tx("Son çizimi geri al")} disabled={!st.annotations.length} onClick={() => setSt((s) => ({ ...s, annotations: s.annotations.slice(0, -1) }))}><Undo2 size={16} /></button>
            <button className="icon-btn" title={tx("Her şeyi sıfırla")} onClick={() => setSt({ adjust: NEUTRAL, annotations: [], crop: null, outWidth: null })}><RotateCcw size={16} /></button>
            <button className="icon-btn" title={tx("Kapat")} onClick={() => edit(null)}><X size={17} /></button>
          </div>
        </header>

        <div className="editor-body">
          <div className={clsx("editor-canvas", `tool-${tool}`)}>
            {img ? (
              <canvas ref={view} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
            ) : (
              <Loader2 className="spin" size={22} />
            )}
          </div>

          <aside className="editor-side">
            <div className="editor-tools">
              {([["adjust", SlidersHorizontal, tx("Ayarla")], ["crop", Crop, tx("Kırp")], ["draw", Pencil, tx("Çiz")], ["text", Type, tx("Yazı")]] as const).map(([id, Icon, label]) => (
                <button key={id} className={clsx(tool === id && "active")} onClick={() => setTool(id)}>
                  <Icon size={16} /> {label}
                </button>
              ))}
            </div>

            {tool === "adjust" && (
              <div className="stack">
                <div className="preset-grid">
                  {PRESETS.map((p) => (
                    <button key={p.id} className={clsx("preset", JSON.stringify(p.adjust) === JSON.stringify(st.adjust) && "active")} onClick={() => setAdjust(p.adjust)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                {SLIDERS.map((s) => (
                  <label key={s.key} className="field">
                    <span>{s.label} · {st.adjust[s.key]}</span>
                    <input type="range" min={s.min} max={100} value={st.adjust[s.key]} onChange={(e) => setAdjust({ [s.key]: Number(e.target.value) })} onDoubleClick={() => setAdjust({ [s.key]: 0 })} />
                  </label>
                ))}
                <p className="muted tiny">{tx("Sıfırlamak için kaydırıcıya çift tıkla.")}</p>
              </div>
            )}

            {tool === "crop" && (
              <div className="stack">
                <p className="muted tiny">{tx("Görüntü üzerinde sürükleyerek kırpma alanını seç.")}</p>
                <div className="preset-grid">
                  {ASPECTS.map((a) => (
                    <button key={a.label} className={clsx("preset", aspect === a.r && "active")} onClick={() => setAspect(a.r)}>{a.label}</button>
                  ))}
                </div>
                {st.crop && <button className="btn btn-ghost btn-sm" onClick={() => setSt((s) => ({ ...s, crop: null }))}>{tx("Kırpmayı kaldır")}</button>}
                <div className="divider" />
                <span className="field-label">{tx("Boyut ·")} {outW}×{outH}</span>
                <div className="preset-grid">
                  {[{ l: tx("Orijinal"), w: null }, { l: "1920", w: 1920 }, { l: "1280", w: 1280 }, { l: "%50", w: -0.5 }].map((o) => (
                    <button
                      key={o.l}
                      className={clsx("preset", (o.w === null ? st.outWidth === null : st.outWidth === (o.w! > 0 ? o.w : Math.round((st.crop?.w ?? img?.width ?? 0) / 2))) && "active")}
                      onClick={() => setSt((s) => ({ ...s, outWidth: o.w === null ? null : o.w > 0 ? o.w : Math.round((s.crop?.w ?? img?.width ?? 0) / 2) }))}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(tool === "draw" || tool === "text") && (
              <div className="stack">
                {tool === "text" && (
                  <>
                    <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Eklenecek yazı")} maxLength={80} />
                    <p className="muted tiny">{tx("Yazmak için görüntüde bir noktaya tıkla.")}</p>
                  </>
                )}
                {tool === "draw" && <p className="muted tiny">{tx("Görüntü üzerinde sürükleyerek çiz.")}</p>}
                <div className="color-row">
                  {COLORS.map((c) => (
                    <button key={c} className={clsx("swatch sm", color === c && "active")} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
                  ))}
                  <label className="swatch sm swatch-custom"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
                </div>
                <label className="field">
                  <span>{tool === "text" ? tx("Yazı boyutu") : tx("Kalem kalınlığı")} · {size}</span>
                  <input type="range" min={2} max={30} value={size} onChange={(e) => setSize(Number(e.target.value))} />
                </label>
              </div>
            )}

            <div className="editor-actions">
              <button className="btn btn-primary" disabled={!img || !!busy} onClick={() => act("save", async () => {
                const saved = await api.saveScreenshotEdit(shot.path, await canvasToBase64(exportCanvas()));
                added(saved);
                flash(tx("Kopya olarak kaydedildi: {0}", saved.file));
                edit(null);
                void api.generateThumbs([saved.path]);
              })}>
                {busy === "save" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {tx("Kopya olarak kaydet")}
              </button>
              <div className="row">
                <button className="btn btn-ghost grow" disabled={!img || !!busy} onClick={() => act("copy", async () => {
                  await api.copyPngBytes(await canvasToBase64(exportCanvas()));
                  flash(tx("Düzenlenmiş görüntü panoya kopyalandı"));
                })}><Copy size={14} /> {tx("Kopyala")}</button>
                <button className="btn btn-ghost grow" disabled={!img || !!busy} onClick={() => act("export", async () => {
                  const dest = await saveDialog({ defaultPath: shot.file.replace(/\.(png|jpe?g)$/i, "_west.png"), filters: [{ name: "PNG", extensions: ["png"] }] });
                  if (!dest) return;
                  await api.exportPng(dest, await canvasToBase64(exportCanvas()));
                  flash(tx("Dışa aktarıldı"));
                })}><Download size={14} /> {tx("Dışa aktar")}</button>
              </div>
              <p className="muted tiny">{tx("Orijinal dosya hiçbir zaman değiştirilmez.")}</p>
            </div>
          </aside>
        </div>
      </motion.div>
    </motion.div>
  );
}
