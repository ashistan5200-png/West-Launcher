import { useEffect, useState } from "react";
import { Check, ClipboardPaste, Keyboard, Layers, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Share2, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/ipc";
import type { GameModes } from "@/lib/types";
import { Modal } from "@/components/Modal";
import { Menu } from "./Menu";
import { askConfirm } from "@/components/ConfirmDialog";
import { tx } from "@/lib/i18n";
import { errorText } from "@/lib/format";

const ICONS = ["🏗️", "⚔️", "⛏️", "🌲", "🎥", "🏹", "🧪", "🌙", "🏆", "🎮"];
const err = (e: unknown) => errorText(e);

/**
 * Oyun modları: "Build modu", "PvP modu" gibi. Her mod hangi modların açık olacağını ve
 * tuş atamalarını (options.txt) saklar; moda geçince hepsi tek tıkla uygulanır.
 */
export function ModesBar({ instanceId, locked, onApplied, onNotice }: {
  instanceId: string;
  locked: boolean;
  onApplied: () => void;
  onNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const [data, setData] = useState<GameModes | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ id: string | null; name: string; icon: string; options: boolean } | null>(null);
  const load = () => api.listModes(instanceId).then(setData).catch(() => setData({ modes: [], active: null }));
  useEffect(() => void load(), [instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async (id: string) => {
    if (locked) return onNotice({ ok: false, text: tx("Oyun açıkken mod değiştirilemez; önce oyunu kapat.") });
    setBusy(id);
    try {
      const r = await api.applyMode(instanceId, id);
      const m = data?.modes.find((x) => x.id === id);
      onNotice({
        ok: true,
        text: tx("{0} {1} etkin: {2} içerik açık, {3} kapalı{4}.{5}", m?.icon ?? "", m?.name ?? "Mod", r.enabled, r.disabled, r.optionsRestored ? ", tuş atamaları ve ayarlar yüklendi" : "", r.missing ? ` ${r.missing} içerik artık yok, atlandı.` : ""),
      });
      await load();
      onApplied();
    } catch (e) { onNotice({ ok: false, text: err(e) }); } finally { setBusy(null); }
  };

  const recapture = async (id: string) => {
    const m = data?.modes.find((x) => x.id === id);
    if (!m || !await askConfirm(tx("\"{0}\" şu anki açık/kapalı içeriklerle{1} güncellensin mi?", m.name, m.hasOptions ? " ve şu anki tuş atamalarıyla" : ""))) return;
    try {
      await api.saveMode(instanceId, id, m.name, m.icon, m.hasOptions);
      onNotice({ ok: true, text: tx("{0} güncellendi.", m.name) });
      await load();
    } catch (e) { onNotice({ ok: false, text: err(e) }); }
  };

  /** Setin paylaşım kodunu panoya kopyala */
  const share = async (id: string) => {
    try {
      const r = await api.setsExport(instanceId, id);
      await navigator.clipboard.writeText(r.code);
      onNotice({ ok: true, text: r.skipped ? tx("Kod kopyalandı. {0} dosya Modrinth'te olmadığı için dışarıda kaldı.", r.skipped) : tx("Set kodu kopyalandı; arkadaşına yapıştır.") });
    } catch (e) { onNotice({ ok: false, text: err(e) }); }
  };

  /** Arkadaşın paylaştığı "WEST-SET:…" kodunu ekle: eksik modlar Modrinth'ten kurulur */
  const importCode = async () => {
    let code = "";
    try { code = (await navigator.clipboard.readText()).trim(); } catch { /* izin yoksa aşağıdaki uyarı */ }
    if (!code.startsWith("WEST-SET:")) return onNotice({ ok: false, text: tx("Panoda set kodu yok. Önce \"WEST-SET:…\" kodunu kopyala.") });
    setBusy("import");
    try {
      const r = await api.setsImport(instanceId, code);
      const extra = [r.missing.length ? tx("{0} tanesi bu sürüm için yok", r.missing.length) : "", r.otherVersion ? tx("set {0} için hazırlanmış", r.otherVersion) : ""].filter(Boolean).join(" · ");
      onNotice({ ok: !r.missing.length, text: tx("\"{0}\" eklendi, {1} içerik kuruldu.", r.name, r.installed) + (extra ? " " + extra + "." : "") });
      await load();
      onApplied();
    } catch (e) { onNotice({ ok: false, text: err(e) }); } finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    const m = data?.modes.find((x) => x.id === id);
    if (!m || !await askConfirm(tx("\"{0}\" silinsin mi? Modların ve dosyaların silinmez; yalnızca bu kayıt kaldırılır.", m.name))) return;
    await api.deleteMode(instanceId, id).catch((e) => onNotice({ ok: false, text: err(e) }));
    await load();
  };

  const submit = async () => {
    if (!editor) return;
    try {
      if (editor.id) await api.renameMode(instanceId, editor.id, editor.name, editor.icon);
      else await api.saveMode(instanceId, null, editor.name, editor.icon, editor.options);
      onNotice({ ok: true, text: editor.id ? tx("Mod güncellendi.") : tx("{0} {1} oluşturuldu. Artık tek tıkla bu düzene dönebilirsin.", editor.icon, editor.name) });
      setEditor(null);
      await load();
    } catch (e) { onNotice({ ok: false, text: err(e) }); }
  };

  if (!data) return null;
  return (
    <div className="modes-bar">
      <span className="modes-label"><Layers size={15} /> {tx("Oyun modları")}</span>
      {data.modes.length === 0 && <span className="muted small">{tx("Build ve PvP gibi farklı mod/tuş düzenleri arasında tek tıkla geç.")}</span>}
      {data.modes.map((m) => (
        <div key={m.id} className={clsx("mode-chip", data.active === m.id && "on")}>
          <button className="mode-main" disabled={!!busy} onClick={() => void apply(m.id)} title={tx("{0} açık, {1} kapalı içerik{2}", m.enabled.length, m.disabled.length, m.hasOptions ? " · tuş atamaları dahil" : "")}>
            {busy === m.id ? <Loader2 size={14} className="spin" /> : <span className="mode-ico">{m.icon}</span>}
            {m.name}
            {m.hasOptions && <Keyboard size={12} className="muted" />}
            {data.active === m.id && <Check size={13} />}
          </button>
          <Menu
            trigger={() => <button className="mode-more" aria-label={tx("Seçenekler")}><MoreHorizontal size={14} /></button>}
            items={[
              { label: tx("Şu anki düzenle güncelle"), icon: <RefreshCw size={14} />, onClick: () => void recapture(m.id) },
              { label: tx("Adını / simgesini değiştir"), icon: <Pencil size={14} />, onClick: () => setEditor({ id: m.id, name: m.name, icon: m.icon, options: m.hasOptions }) },
              { label: tx("Paylaşım kodunu kopyala"), icon: <Share2 size={14} />, onClick: () => void share(m.id) },
              { label: tx("Sil"), icon: <Trash2 size={14} />, danger: true, onClick: () => void remove(m.id) },
            ]}
          />
        </div>
      ))}
      <button className="mode-add" onClick={() => setEditor({ id: null, name: data.modes.length ? "" : tx("Build Modu"), icon: data.modes.length ? "⚔️" : "🏗️", options: true })}>
        <Plus size={14} /> {tx("Mod oluştur")}
      </button>
      <button className="mode-add" disabled={busy === "import" || locked} title={tx("Arkadaşının set kodunu kopyala, sonra buna bas")} onClick={() => void importCode()}>
        {busy === "import" ? <Loader2 size={14} className="spin" /> : <ClipboardPaste size={14} />} {tx("Kodla ekle")}
      </button>

      <Modal open={!!editor} onClose={() => setEditor(null)} title={editor?.id ? tx("Modu düzenle") : tx("Yeni oyun modu")} width={440}
        footer={<><button className="btn btn-ghost" onClick={() => setEditor(null)}>{tx("Vazgeç")}</button><button className="btn btn-primary" disabled={!editor?.name.trim()} onClick={() => void submit()}>{editor?.id ? tx("Kaydet") : tx("Oluştur")}</button></>}>
        {editor && (
          <>
            {!editor.id && <p className="small muted">{tx("Şu an")} <strong>{tx("açık")}</strong> {tx("olan modlar, resource pack'ler ve shader'lar bu moda kaydedilir. Önce modları istediğin gibi açıp kapat, sonra modu oluştur.")}</p>}
            <label className="field"><span>{tx("Ad")}</span><input autoFocus value={editor.name} maxLength={32} placeholder={tx("Örn. PvP Modu")} onChange={(e) => setEditor({ ...editor, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && editor.name.trim() && void submit()} /></label>
            <div className="field">
              <span>{tx("Simge")}</span>
              <div className="mode-icons">
                {ICONS.map((i) => <button key={i} className={clsx("mode-icon", editor.icon === i && "on")} onClick={() => setEditor({ ...editor, icon: i })}>{i}</button>)}
              </div>
            </div>
            {!editor.id && (
              <label className="check"><input type="checkbox" checked={editor.options} onChange={(e) => setEditor({ ...editor, options: e.target.checked })} /> <Keyboard size={14} /> {tx("Tuş atamalarını ve oyun ayarlarını da kaydet (options.txt)")}</label>
            )}
            {!editor.id && editor.options && <p className="muted tiny">{tx("Bu moddayken oyunda değiştirdiğin tuşlar, başka moda geçerken bu moda kendiliğinden kaydedilir.")}</p>}
          </>
        )}
      </Modal>
    </div>
  );
}
