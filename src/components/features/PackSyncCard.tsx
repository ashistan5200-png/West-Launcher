import { useEffect, useState } from "react";
import { Copy, Link2, Loader2, RefreshCw, Unlink, Users } from "lucide-react";
import { api, isTauri } from "@/lib/ipc";
import { errorText, formatRelative } from "@/lib/format";
import type { Instance, SyncStatus } from "@/lib/types";
import { askConfirm } from "@/components/ConfirmDialog";
import { tx } from "@/lib/i18n";

/** Paylaş sekmesinde: paketi arkadaşlarınla senkron tut (sahip: yayınla/güncelle; üye: güncelle) */
export function PackSyncCard({ instance }: { instance: Instance }) {
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => isTauri() && api.packSyncStatus(instance.id).then(setSt).catch(() => setSt({ link: null, hasUpdate: false, remoteName: null, remoteUpdatedAt: null }));
  useEffect(() => void load(), [instance.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const link = st?.link;

  return (
    <section className="card stack">
      <h3><Users size={17} /> {tx("Arkadaşlarla senkron")}</h3>
      {!link && (
        <>
          <p className="muted small">{tx("Paketini bir kodla paylaş. Kodu kullanan arkadaşın aynı modları kurar; sen değiştirdikçe onun launcher'ı \"Güncelleme var\" der ve tek tıkla aynı hâle gelir. West hesabı gerekir.")}</p>
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => void act(async () => tx("Paylaşıldı. Kod: {0}", await api.packSyncPublish(instance.id)))}>
            {busy ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />} {tx("Senkron kodu oluştur")}
          </button>
        </>
      )}
      {link?.role === "owner" && (
        <>
          <div className="sync-code">
            <code>{link.code}</code>
            <button className="icon-btn" title={tx("Kopyala")} onClick={() => void navigator.clipboard.writeText(link.code).then(() => setMsg({ ok: true, text: tx("Kod kopyalandı") }))}><Copy size={15} /></button>
          </div>
          <p className="muted small">{tx("Son yayın: {0}. Mod ekleyip çıkardıktan sonra \"Güncelle\"ye bas; arkadaşların değişikliği görür.", link.updatedAt ? formatRelative(link.updatedAt) : "—")}</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => void act(async () => { await api.packSyncPublish(instance.id); return tx("Arkadaşlarına güncel liste gönderildi"); })}>
              {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} {tx("Güncelle")}
            </button>
            <button className="btn btn-ghost" onClick={async () => { if (await askConfirm(tx("Bu paketin senkronu durdurulsun mu? Arkadaşların güncelleme almaz."), { danger: false })) { await api.packSyncUnlink(instance.id); await load(); } }}><Unlink size={15} /> {tx("Durdur")}</button>
          </div>
        </>
      )}
      {link?.role === "member" && (
        <>
          <p className="muted small">{tx("Bu paket \"{0}\" koduyla bir arkadaşının paketine bağlı.", link.code)}</p>
          {st?.hasUpdate ? (
            <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => void act(async () => { const r = await api.packSyncPull(instance.id); return tx("Güncellendi: {0} yeni içerik", r.installed) + (r.missing.length ? " · " + tx("{0} bulunamadı", r.missing.length) : ""); })}>
              {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} {tx("Güncelleme var · uygula")}
            </button>
          ) : (
            <p className="muted small">{tx("Güncel. Arkadaşın değişiklik yapınca burada görürsün.")}</p>
          )}
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={async () => { await api.packSyncUnlink(instance.id); await load(); }}><Unlink size={14} /> {tx("Bağlantıyı kopar")}</button>
        </>
      )}
      {msg && <p className={msg.ok ? "hint ok" : "hint error"}>{msg.text}</p>}
    </section>
  );
}
