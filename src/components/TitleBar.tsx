import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNavigate } from "react-router-dom";
import { Minus, Square, X } from "lucide-react";
import { isTauri } from "@/lib/ipc";
import { useAccounts } from "@/stores/accounts";
import { useWest } from "@/stores/west";
import { useEffect } from "react";
import { Logo } from "./Logo";
import { UpdateButton } from "./UpdateCenter";

const win = () => (isTauri() ? getCurrentWindow() : null);

export function TitleBar() {
  const navigate = useNavigate();
  const account = useAccounts((s) => s.accounts.find((a) => a.active) ?? null);
  const west = useWest((s) => s.account);
  const loadWest = useWest((s) => s.load);
  useEffect(() => void loadWest(), [loadWest]);
  const name = west?.username ?? account?.username;
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <Logo size={20} />
        <span className="wordmark" data-tauri-drag-region>West<b>Client</b></span>
      </div>
      <div className="titlebar-actions">
        <UpdateButton />
        <button className="tb-account" onClick={() => navigate("/skins")} title="Hesap ve skin">
          <span className="tb-avatar">{(name ?? "?").slice(0, 1).toUpperCase()}</span>
          <span className="truncate">{name ?? "Giriş yap"}</span>
          {west ? <span className="tb-kind west">West</span> : account && <span className={`tb-kind ${account.kind}`}>{account.kind === "microsoft" ? "MS" : "Offline"}</span>}
        </button>
        <span className="tb-sep" />
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
