import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { isTauri } from "@/lib/ipc";
import { Logo } from "./Logo";

const win = () => (isTauri() ? getCurrentWindow() : null);

export function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <Logo size={18} />
        <span data-tauri-drag-region>West</span>
      </div>
      <div className="titlebar-actions">
        <button className="tb-btn" aria-label="Küçült" onClick={() => win()?.minimize()}>
          <Minus size={14} />
        </button>
        <button className="tb-btn" aria-label="Büyüt" onClick={() => win()?.toggleMaximize()}>
          <Square size={12} />
        </button>
        <button className="tb-btn tb-close" aria-label="Kapat" onClick={() => win()?.close()}>
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
