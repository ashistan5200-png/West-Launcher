import { useEffect, useState } from "react";
import { Check, Keyboard, Layers, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/ipc";
import type { GameModes } from "@/lib/types";
import { Modal } from "@/components/Modal";
import { Menu } from "./Menu";
import { askConfirm } from "@/components/ConfirmDialog";

const ICONS = ["🏗️", "⚔️", "⛏️", "🌲", "🎥", "🏹", "🧪", "🌙", "🏆", "🎮"];
const err = (e: unknown) => String(e).replace(/^Error: /, "");

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
    if (locked) return onNotice({ ok: false, text: "Oyun açıkken mod değiştirilemez; önce oyunu kapat." });
    setBusy(id);
    try {
      const r = await api.applyMode(instanceId, id);
      const m = data?.modes.find((x) => x.id === id);
      onNotice({
        ok: true,
        text: `${m?.icon ?? ""} ${m?.name ?? "Mod"} etkin: ${r.enabled} içerik açık, ${r.disabled} kapalı${r.optionsRestored ? ", tuş atamaları ve ayarlar yüklendi" : ""}.${r.missing ? ` ${r.missing} içerik artık yok, atlandı.` : ""}`,
      });
      await load();
      onApplied();
    } catch (e) { onNotice({ ok: false, text: err(e) }); } finally { setBusy(null); }
  };

  const recapture = async (id: string) => {
    const m = data?.modes.find((x) => x.id === id);
    if (!m || !await askConfirm(`"${m.name}" şu anki açık/kapalı içeriklerle${m.hasOptions ? " ve şu anki tuş atamalarıyla" : ""} güncellensin mi?`)) return;
    try {
      await api.saveMode(instanceId, id, m.name, m.icon, m.hasOptions);
      onNotice({ ok: true, text: `${m.name} güncellendi.` });
      await load();
    } catch (e) { onNotice({ ok: false, text: err(e) }); }
  };

  const remove = async (id: string) => {
    const m = data?.modes.find((x) => x.id === id);
    if (!m || !await askConfirm(`"${m.name}" silinsin mi? Modların ve dosyaların silinmez; yalnızca bu kayıt kaldırılır.`)) return;
    await api.deleteMode(instanceId, id).catch((e) => onNotice({ ok: false, text: err(e) }));
    await load();
  };

  const submit = async () => {
    if (!editor) return;
    try {
      if (editor.id) await api.renameMode(instanceId, editor.id, editor.name, editor.icon);
      else await api.saveMode(instanceId, null, editor.name, editor.icon, editor.options);
      onNotice({ ok: true, text: editor.id ? "Mod güncellendi." : `${editor.icon} ${editor.name} oluşturuldu. Artık tek tıkla bu düzene dönebilirsin.` });
      setEditor(null);
      await load();
    } catch (e) { onNotice({ ok: false, text: err(e) }); }
  };

  if (!data) return null;
  return (
    <div className="modes-bar">
      <span className="modes-label"><Layers size={15} /> Oyun modları</span>
      {data.modes.length === 0 && <span className="muted small">Build ve PvP gibi farklı mod/tuş düzenleri arasında tek tıkla geç.</span>}
      {data.modes.map((m) => (
        <div key={m.id} className={clsx("mode-chip", data.active === m.id && "on")}>
          <button className="mode-main" disabled={!!busy} onClick={() => void apply(m.id)} title={`${m.enabled.length} açık, ${m.disabled.length} kapalı içerik${m.hasOptions ? " · tuş atamaları dahil" : ""}`}>
            {busy === m.id ? <Loader2 size={14} className="spin" /> : <span className="mode-ico">{m.icon}</span>}
            {m.name}
            {m.hasOptions && <Keyboard size={12} className="muted" />}
            {data.active === m.id && <Check size={13} />}
          </button>
          <Menu
            trigger={() => <button className="mode-more" aria-label="Seçenekler"><MoreHorizontal size={14} /></button>}
            items={[
              { label: "Şu anki düzenle güncelle", icon: <RefreshCw size={14} />, onClick: () => void recapture(m.id) },
              { label: "Adını / simgesini değiştir", icon: <Pencil size={14} />, onClick: () => setEditor({ id: m.id, name: m.name, icon: m.icon, options: m.hasOptions }) },
              { label: "Sil", icon: <Trash2 size={14} />, danger: true, onClick: () => void remove(m.id) },
            ]}
          />
        </div>
      ))}
      <button className="mode-add" onClick={() => setEditor({ id: null, name: data.modes.length ? "" : "Build Modu", icon: data.modes.length ? "⚔️" : "🏗️", options: true })}>
        <Plus size={14} /> Mod oluştur
      </button>

      <Modal open={!!editor} onClose={() => setEditor(null)} title={editor?.id ? "Modu düzenle" : "Yeni oyun modu"} width={440}
        footer={<><button className="btn btn-ghost" onClick={() => setEditor(null)}>Vazgeç</button><button className="btn btn-primary" disabled={!editor?.name.trim()} onClick={() => void submit()}>{editor?.id ? "Kaydet" : "Oluştur"}</button></>}>
        {editor && (
          <>
            {!editor.id && <p className="small muted">Şu an <strong>açık</strong> olan modlar, resource pack'ler ve shader'lar bu moda kaydedilir. Önce modları istediğin gibi açıp kapat, sonra modu oluştur.</p>}
            <label className="field"><span>Ad</span><input autoFocus value={editor.name} maxLength={32} placeholder="Örn. PvP Modu" onChange={(e) => setEditor({ ...editor, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && editor.name.trim() && void submit()} /></label>
            <div className="field">
              <span>Simge</span>
              <div className="mode-icons">
                {ICONS.map((i) => <button key={i} className={clsx("mode-icon", editor.icon === i && "on")} onClick={() => setEditor({ ...editor, icon: i })}>{i}</button>)}
              </div>
            </div>
            {!editor.id && (
              <label className="check"><input type="checkbox" checked={editor.options} onChange={(e) => setEditor({ ...editor, options: e.target.checked })} /> <Keyboard size={14} /> Tuş atamalarını ve oyun ayarlarını da kaydet (options.txt)</label>
            )}
            {!editor.id && editor.options && <p className="muted tiny">Bu moddayken oyunda değiştirdiğin tuşlar, başka moda geçerken bu moda kendiliğinden kaydedilir.</p>}
          </>
        )}
      </Modal>
    </div>
  );
}
