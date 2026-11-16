import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

type Pos = { top: number; left?: number; right?: number; up: boolean; maxH: number };

/**
 * Küçük açılır menü: dışarı tıklayınca veya Esc ile kapanır. Menü gövdeye (body) çizilir,
 * böylece taşmayı gizleyen kartların (ör. instance başlığı) içinde kesilmez; altta yer
 * yoksa yukarı doğru açılır.
 */
export function Menu({ trigger, items, align = "right", className, wide }: { trigger: (open: boolean) => ReactNode; items: MenuItem[]; align?: "left" | "right"; className?: string; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const est = Math.min(items.length * 38 + 12, 420);
    const below = window.innerHeight - r.bottom - 8;
    const up = below < est && r.top > below;
    setPos({
      top: up ? r.top - 6 : r.bottom + 6,
      ...(align === "right" ? { right: window.innerWidth - r.right } : { left: r.left }),
      up,
      maxH: Math.max(160, (up ? r.top : below) - 12),
    });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Kaydırma ya da boyut değişince konum bayatlar → kapat
    const close = (e: Event) => { if (!(e.target instanceof Node && pop.current?.contains(e.target))) setOpen(false); };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div className={clsx("menu-wrap", className)} ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={pop}
              className={clsx("menu-pop floating", align, wide && "wide")}
              style={{
                position: "fixed",
                top: pos.up ? undefined : pos.top,
                bottom: pos.up ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                right: pos.right,
                maxHeight: pos.maxH,
              }}
              initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.12 }}
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  className={clsx("menu-item", it.danger && "danger", it.active && "active")}
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                >
                  {it.icon}
                  <span>{it.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/** Açma/kapama anahtarı */
export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} className={clsx("switch", on && "on")} disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}
