import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { Loader2, Play, Server, Users } from "lucide-react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/ipc";
import { errorText } from "@/lib/format";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { tx } from "@/lib/i18n";
import type { InviteInfo } from "@/lib/types";

const LOADERS: Record<string, string> = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", vanilla: "Vanilla" };

/**
 * Discord'daki "Birlikte oyna" düğmesinden gelen davet: westclient://katil/KOD.
 * Arkadaşın paketini (aynı sürüm, aynı modlar) kurar ve aynı sunucuya bağlanır.
 */
export function InviteHost() {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    void api.takePendingInvite().then((c) => c && setCode(c)).catch(() => {});
    const un = listen<string>("west-invite", (e) => {
      setCode(e.payload);
      void api.takePendingInvite().catch(() => {});
    });
    return () => { void un.then((f) => f()); };
  }, []);
  if (!code) return null;
  return <InviteModal key={code} code={code} onClose={() => setCode(null)} />;
}

function InviteModal({ code, onClose }: { code: string; onClose: () => void }) {
  const navigate = useNavigate();
  const refresh = useInstances((s) => s.refresh);
  const launch = useInstances((s) => s.launch);
  const offlineName = useSettings((s) => s.offlineName);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.inviteInfo(code).then(setInfo).catch((e) => setError(errorText(e)));
  }, [code]);

  const go = async (play: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const inst = await api.inviteInstall(code);
      await refresh();
      onClose();
      if (play) await launch(inst.id, offlineName, info?.server ?? undefined);
      else navigate(`/instance/${inst.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const loader = info ? LOADERS[info.loader.toLowerCase()] ?? info.loader : "";
  return (
    <Modal open title={tx("Birlikte oyna")} onClose={busy ? () => {} : onClose} width={460}>
      <div className="feat">
        {!info && !error && <p className="feat-lead"><Loader2 size={15} className="spin" /> {tx("Davet açılıyor…")}</p>}
        {info && (
          <>
            <p className="feat-lead">
              {info.server
                ? tx("Arkadaşın bu paketle {0} sunucusunda oynuyor. Aynı paketi kurup yanına bağlanabilirsin.", info.server)
                : tx("Arkadaşın bu paketle oynuyor. Aynı paketi kurup sen de oynayabilirsin.")}
            </p>
            <div className="invite-card">
              <div className="invite-name"><Users size={16} /> {info.name}</div>
              <div className="invite-meta">
                <span>{loader} {info.mc}</span>
                {info.mods > 0 && <span>{tx("{0} mod", info.mods)}</span>}
                {info.packs > 0 && <span>{tx("{0} paket ve shader", info.packs)}</span>}
                {info.server && <span><Server size={13} /> {info.server}</span>}
              </div>
              {info.installed && <p className="invite-note">{tx("Bu paket zaten kurulu; yeniden indirilmez.")}</p>}
            </div>
            <div className="feat-actions">
              <button className="btn btn-ghost" disabled={busy} onClick={() => void go(false)}>{tx("Yalnızca kur")}</button>
              <button className="btn btn-primary grow" disabled={busy} onClick={() => void go(true)}>
                {busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />} {info.server ? tx("Kur ve katıl") : tx("Kur ve oyna")}
              </button>
            </div>
          </>
        )}
        {error && <p className="feat-error">{error}</p>}
      </div>
    </Modal>
  );
}
