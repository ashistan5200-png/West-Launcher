import { useEffect, useRef, useState } from "react";

interface Tip {
  text: string;
  x: number;
  y: number;
  side: "right" | "bottom" | "top";
}

const DELAY_MS = 380;

/**
 * Uygulama genelinde ipucu katmanı. Tarayıcının kaba `title` kutusu yerine
 * temaya uygun bir baloncuk gösterir. Hiçbir bileşenin değişmesi gerekmez:
 * imleç `title` taşıyan bir öğeye geldiğinde metin `data-tip`'e taşınır
 * (yerel kutu böylece hiç açılmaz), ekran okuyucular için `aria-label` korunur.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number>();
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };

    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[title], [data-tip]");
      if (!el || el === current.current) return;
      const title = el.getAttribute("title");
      if (title) {
        el.setAttribute("data-tip", title);
        el.removeAttribute("title");
        if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", title);
      }
      const text = el.getAttribute("data-tip");
      if (!text) return;
      current.current = el;
      window.clearTimeout(timer.current);
      // Bir ipucu zaten açıksa komşu öğeye geçerken beklemeden göster
      const wait = tip ? 0 : DELAY_MS;
      timer.current = window.setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const inSidebar = !!el.closest(".sidebar");
        if (inSidebar) setTip({ text, x: r.right + 10, y: r.top + r.height / 2, side: "right" });
        else if (r.bottom + 40 > window.innerHeight) setTip({ text, x: r.left + r.width / 2, y: r.top - 8, side: "top" });
        else setTip({ text, x: r.left + r.width / 2, y: r.bottom + 8, side: "bottom" });
      }, wait);
    };

    const onOut = (e: MouseEvent) => {
      const to = e.relatedTarget as Element | null;
      if (current.current && to && current.current.contains(to)) return;
      if (current.current && (e.target as Element).closest?.("[data-tip]") === current.current) hide();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [tip]);

  if (!tip) return null;
  return (
    <div className={`tooltip tooltip-${tip.side}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
    </div>
  );
}
