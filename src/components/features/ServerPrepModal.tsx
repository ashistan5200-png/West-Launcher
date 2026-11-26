import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Loader2, Server, Users, Wifi } from "lucide-react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/ipc";
import { errorText } from "@/lib/format";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import type { ServerPrepResult, ServerProbe } from "@/lib/types";
import { tx } from "@/lib/i18n";

/**
 * Sunucuya göre hazırla: adresi sorgular (sürüm, oyuncu sayısı, Forge/NeoForge mod listesi), onayla
 * o sürümde bir instance kurar, bulabildiği modları indirir ve sunucuyu listeye ekler.
 */
export function ServerPrepModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const refresh = useInstances((s) => s.refresh);
  const launch = useInstances((s) => s.launch);
  const offlineName = useSettings((s) => s.offlineName);
  const [address, setAddress] = useState("");
  const [probe, setProbe] = useState<ServerProbe | null>(null);
  const [result, setResult] = useState<ServerPrepResult | null>(null);
  const [busy, setBusy] = useState<null | "probe" | "prep">(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy("probe");
    setError(null);
    setProbe(null);
    try {
      setProbe(await api.serverProbe(address));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const prep = async () => {
    setBusy("prep");
    setError(null);
    try {
      const r = await api.serverPrep(address);
      await refresh();
      setResult(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open title={tx("Sunucuya göre hazırla")} onClose={onClose} width={500}>
      <div className="feat">
        {!result && (
          <>
            <p className="feat-lead">{tx("Sunucunun adresini yaz. Sürümünü ve gereken modları bulup sana hazır bir paket kurarım; sunucu da listende olur.")}</p>
            <form className="feat-row" onSubmit={(e) => { e.preventDefault(); if (address.trim()) void check(); }}>
              <input autoFocus placeholder={tx("ör. play.ornek.com")} value={address} onChange={(e) => { setAddress(e.target.value); setProbe(null); }} />
              <button className="btn btn-ghost" disabled={!address.trim() || !!busy}>
                {busy === "probe" ? <Loader2 size={15} className="spin" /> : <Wifi size={15} />} {tx("Sorgula")}
              </button>
            </form>
          </>
        )}
        {error && <p className="feat-error">{error}</p>}

        {probe && !result && (
          <div className="feat-card">
            <div className="feat-server">
              {probe.favicon ? <img src={probe.favicon} alt="" /> : <span className="feat-server-ph"><Server size={20} /></span>}
              <div className="grow">
                <strong>{probe.address}</strong>
                {probe.motd && <span className="feat-motd">{probe.motd}</span>}
              </div>
              <span className="feat-pill"><Users size={12} /> {probe.online}/{probe.max}</span>
            </div>
            <dl className="feat-facts">
              <div><dt>{tx("Sürüm")}</dt><dd>{probe.mcVersion ?? tx("anlaşılamadı")} <span>({probe.versionName})</span></dd></div>
              <div><dt>{tx("Tür")}</dt><dd>{probe.loader === "neoforge" ? "NeoForge" : probe.loader === "forge" ? "Forge" : tx("Vanilla / eklentili")}</dd></div>
              {probe.mods.length > 0 && <div><dt>{tx("Modlar")}</dt><dd>{tx("{0} mod bildirildi", probe.mods.length)}</dd></div>}
            </dl>
            {!probe.loader && <p className="feat-note">{tx("Sunucu mod listesi bildirmiyor (Paper/Spigot ya da Fabric olabilir). Doğru sürümde temiz bir paket kurulur; gerekirse modları sonra eklersin.")}</p>}
            <button className="btn btn-primary btn-lg feat-go" disabled={!probe.mcVersion || !!busy} onClick={() => void prep()}>
              {busy === "prep" ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              {busy === "prep" ? tx("Kuruluyor…") : tx("Bu sunucu için paket kur")}
            </button>
          </div>
        )}

        {result && (
          <div className="feat-card">
            <p className="feat-done"><Check size={16} /> {tx("{0} hazır", result.instance.name)}</p>
            <p className="feat-lead">
              {tx("Minecraft {0}", result.instance.mcVersion)}
              {result.installed.length > 0 && ` · ${tx("{0} mod kuruldu", result.installed.length)}`}
            </p>
            {result.missing.length > 0 && (
              <p className="feat-note">{tx("Modrinth'te bulunamayanlar (elle eklemen gerekebilir): {0}", result.missing.slice(0, 12).join(", "))}{result.missing.length > 12 ? "…" : ""}</p>
            )}
            <div className="feat-row">
              <button className="btn btn-primary btn-lg grow" onClick={() => { void launch(result.instance.id, offlineName, result.probe.address); onClose(); }}>{tx("Oyna ve bağlan")}</button>
              <button className="btn btn-ghost btn-lg" onClick={() => { navigate(`/instance/${result.instance.id}`); onClose(); }}>{tx("Paketi aç")}</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
