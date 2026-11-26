import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNavigate } from "react-router-dom";
import { Minus, Square, X } from "lucide-react";
import { isTauri } from "@/lib/ipc";
import { useAccounts } from "@/stores/accounts";
import { useWest } from "@/stores/west";
import { useProfile } from "@/stores/profile";
import { useEffect, useState } from "react";
import { api } from "@/lib/ipc";
import { useInstances } from "@/stores/instances";
import { Logo } from "./Logo";
import { UpdateButton } from "./UpdateCenter";
import { tx } from "@/lib/i18n";

const win = () => (isTauri() ? getCurrentWindow() : null);

export function TitleBar() {
  const navigate = useNavigate();
  const account = useAccounts((s) => s.accounts.find((a) => a.active) ?? null);
  const west = useWest((s) => s.account);
  const loadWest = useWest((s) => s.load);
  useEffect(() => void loadWest(), [loadWest]);
  const me = useProfile((s) => s.me);
  const name = west ? me?.display_name || west.username : account?.username;
  const loadMe = useProfile((s) => s.loadMe);
  useEffect(() => { if (west) void loadMe(); }, [west, loadMe]);
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <Logo size={20} />
        <span className="wordmark" data-tauri-drag-region>{tx("West")}<b>{tx("Client")}</b></span>
      </div>
      <div className="titlebar-actions">
        <RunningPill />
        <UpdateButton />
        <button className="tb-account" onClick={() => navigate("/account")} title={tx("Hesabım ve profilim")}>
          {me?.avatar_url ? <img className="tb-avatar" src={me.avatar_url} alt="" /> : <span className="tb-avatar">{(name ?? "?").slice(0, 1).toUpperCase()}</span>}
          <span className="truncate">{name ?? tx("Giriş yap")}</span>
          {west ? <span className="tb-kind west">{tx("West")}</span> : account && <span className={`tb-kind ${account.kind}`}>{account.kind === "microsoft" ? "MS" : tx("Offline")}</span>}
        </button>
        <span className="tb-sep" />
        <button className="tb-btn" aria-label={tx("Küçült")} onClick={() => win()?.minimize()}>
          <Minus size={14} />
        </button>
        <button className="tb-btn" aria-label={tx("Büyüt")} onClick={() => win()?.toggleMaximize()}>
          <Square size={12} />
        </button>
        <button className="tb-btn tb-close" aria-label={tx("Kapat")} onClick={() => win()?.close()}>
          <X size={14} />
        </button>
      </div>
    </header>
  );
}

const clock = (secs: number) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), x = secs % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(x).padStart(2, "0")}`;
};

/** Ortadaki rozet: çalışan instance'ın adı ve oyun süresi; yoksa "Çalışan instance yok". */
function RunningPill() {
  const navigate = useNavigate();
  const instances = useInstances((s) => s.instances);
  const running = useInstances((s) => s.running);
  const ids = Object.keys(running);
  const [started, setStarted] = useState<Record<string, number>>({});
  const [, tick] = useState(0);

  // Başlangıç zamanını Rust'tan al (launcher sonradan açıldıysa da doğru süre)
  useEffect(() => {
    if (!ids.length || !isTauri()) return;
    void api.running().then((list) => setStarted(Object.fromEntries(list.map((r) => [r.instanceId, Date.now() - r.uptimeSecs * 1000]))));
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ids.length) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [ids.length]);

  const live = ids.map((id) => instances.find((i) => i.id === id)).filter(Boolean);
  if (!live.length) return <div className="tb-running idle" data-tauri-drag-region><span className="tb-dot" /> {tx("Çalışan instance yok")}</div>;
  const first = live[0]!;
  const secs = started[first.id] ? Math.max(0, Math.floor((Date.now() - started[first.id]) / 1000)) : null;
  return (
    <button className="tb-running live" onClick={() => navigate(`/instance/${first.id}`)} title={tx("Instance'a git")}>
      <span className="tb-dot" />
      <span className="truncate">{first.name}</span>
      {live.length > 1 && <span className="tb-more">+{live.length - 1}</span>}
      {secs !== null && <span className="tb-time">{clock(secs)}</span>}
    </button>
  );
}
