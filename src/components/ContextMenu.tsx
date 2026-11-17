import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ClipboardPaste, Copy, Home, Scissors, Settings, TextSelect } from "lucide-react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isTauri } from "@/lib/ipc";
import { tx } from "@/lib/i18n";

type Item = { label: string; icon: typeof Copy; hint?: string; run: () => void } | "sep";

async function copy(text: string) {
  try {
    if (isTauri()) await writeText(text);
    else await navigator.clipboard.writeText(text);
  } catch {
    document.execCommand("copy");
  }
}

async function paste(): Promise<string> {
  try {
    return isTauri() ? await readText() : await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

/** Seçili metni (input/textarea dahil) değiştirir ve React'e haber verir. */
function insertInto(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
  setter?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.setSelectionRange(start + text.length, start + text.length);
}

/**
 * Tarayıcının varsayılan (beyaz, "Yazdır / Farklı kaydet") menüsü yerine
 * uygulamanın temasına uyan sade bir sağ tık menüsü.
 */
export function ContextMenu() {
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ x: number; y: number; items: Item[] } | null>(null);

  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      const t = e.target as HTMLElement;
      const field = t.closest(tx("input, textarea")) as HTMLInputElement | HTMLTextAreaElement | null;
      const editable = field && !field.readOnly && !field.disabled && !["checkbox", "radio", "range", "color", "file"].includes((field as HTMLInputElement).type);
      const selected = field ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0) : window.getSelection()?.toString() ?? "";
      const items: Item[] = [];
      if (editable && field) {
        items.push(
          { label: tx("Kes"), icon: Scissors, hint: tx("Ctrl+X"), run: () => { if (selected) { void copy(selected); insertInto(field, ""); } } },
          { label: tx("Kopyala"), icon: Copy, hint: tx("Ctrl+C"), run: () => selected && void copy(selected) },
          { label: tx("Yapıştır"), icon: ClipboardPaste, hint: tx("Ctrl+V"), run: () => void paste().then((txt) => txt && insertInto(field, txt)) },
          { label: tx("Tümünü seç"), icon: TextSelect, hint: tx("Ctrl+A"), run: () => { field.focus(); field.select(); } },
        );
      } else if (selected) {
        items.push({ label: tx("Kopyala"), icon: Copy, hint: tx("Ctrl+C"), run: () => void copy(selected) });
      }
      if (items.length) items.push("sep");
      items.push(
        { label: tx("Geri"), icon: ArrowLeft, hint: tx("Alt+←"), run: () => navigate(-1) },
        { label: tx("İleri"), icon: ArrowRight, hint: tx("Alt+→"), run: () => navigate(1) },
        "sep",
        { label: tx("Ana sayfa"), icon: Home, run: () => navigate("/") },
        { label: tx("Ayarlar"), icon: Settings, run: () => navigate("/settings") },
      );
      // Ekrandan taşmasın
      const w = 220, h = items.length * 34;
      setMenu({ x: Math.min(e.clientX, window.innerWidth - w - 8), y: Math.min(e.clientY, window.innerHeight - h - 8), items });
    };
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("contextmenu", onMenu);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("contextmenu", onMenu);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
    };
  }, [navigate]);

  return (
    <AnimatePresence>
      {menu && (
        <motion.div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          initial={{ opacity: 0, scale: 0.97, y: -3 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.1 }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.items.map((it, i) =>
            it === "sep" ? (
              <div key={i} className="ctx-sep" />
            ) : (
              <button key={i} className="ctx-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { setMenu(null); it.run(); }}>
                <it.icon size={15} />
                <span>{it.label}</span>
                {it.hint && <kbd>{it.hint}</kbd>}
              </button>
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
