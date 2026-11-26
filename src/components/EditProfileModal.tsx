import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Link2, Loader2, X } from "lucide-react";
import { api } from "@/lib/ipc";
import { updateProfile, type Profile } from "@/lib/profile";
import { pickCropped } from "@/components/ImageCropper";
import { Modal } from "@/components/Modal";
import { errorText } from "@/lib/format";
import { tx } from "@/lib/i18n";

/** West profilini düzenle: fotoğraf, banner, ad, biyografi, konum, Minecraft adı ve bağlantılar */
export function EditProfileModal({ open, onClose, profile, onSaved }: { open: boolean; onClose: () => void; profile: Profile; onSaved: (p: Profile) => void }) {
  const [d, setD] = useState(profile);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setD(profile); setError(null); } }, [open, profile]);
  const upload = async (field: "avatar_url" | "banner_url") => {
    const avatar = field === "avatar_url";
    try {
      // Önce kırpma penceresi: konum, yakınlaştırma, döndürme
      const path = await pickCropped(avatar
        ? { aspect: 1, round: true, title: tx("Profil fotoğrafını ayarla"), outWidth: 512 }
        : { aspect: 3, title: tx("Banner'ı ayarla"), outWidth: 1500 });
      if (!path) return;
      setBusy(field);
      const url = await api.westUpload(path, avatar ? "avatars" : "banners");
      setD((cur) => ({ ...cur, [field]: url }));
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const links = useMemo(() => (d.links?.length ? d.links : []), [d.links]);
  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const [np] = await updateProfile(profile.id, {
        display_name: d.display_name?.trim() || null, bio: d.bio?.trim() || null, location: d.location?.trim() || null, website: d.website?.trim() || null,
        mc_username: d.mc_username?.trim() || null, avatar_url: d.avatar_url, banner_url: d.banner_url,
        links: links.filter((l) => /^https?:\/\//.test(l.url.trim())).map((l) => ({ label: l.label.trim().slice(0, 30), url: l.url.trim() })).slice(0, 5),
      });
      onSaved(np);
      onClose();
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  return (
    <Modal open={open} onClose={onClose} title={tx("Profili düzenle")} width={620}
      footer={<><button className="btn btn-ghost" onClick={onClose}>{tx("Vazgeç")}</button><button className="btn btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" && <Loader2 size={15} className="spin" />} {tx("Kaydet")}</button></>}>
      <div className="s-edit">
        <div className="s-edit-head">
          <button type="button" className="s-edit-banner" onClick={() => void upload("banner_url")} disabled={!!busy} aria-label={tx("Banner'ı değiştir")}>
            {d.banner_url ? <img src={d.banner_url} alt="" referrerPolicy="no-referrer" /> : <div className="s-banner-ph" />}
            <span className="s-edit-cam">{busy === "banner_url" ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />} {tx("Banner'ı değiştir")}</span>
          </button>
          {d.banner_url && <button type="button" className="s-edit-rm" title={tx("Banner'ı kaldır")} onClick={() => setD({ ...d, banner_url: null })}><X size={14} /></button>}
          <button type="button" className="s-edit-avatar" onClick={() => void upload("avatar_url")} disabled={!!busy} aria-label={tx("Profil fotoğrafını değiştir")}>
            <Avatar url={d.avatar_url} name={d.username} size={96} />
            <span className="s-edit-cam round">{busy === "avatar_url" ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />}</span>
          </button>
          {d.avatar_url && <button type="button" className="s-edit-rm avatar" title={tx("Fotoğrafı kaldır")} onClick={() => setD({ ...d, avatar_url: null })}><X size={12} /></button>}
        </div>
        <label className="field"><span>{tx("Görünen ad")}</span><input value={d.display_name ?? ""} maxLength={40} placeholder={d.username} onChange={(e) => setD({ ...d, display_name: e.target.value })} /></label>
        <label className="field"><span>{tx("Biyografi")} <span className="muted">({(d.bio ?? "").length}/300)</span></span><textarea rows={4} maxLength={300} value={d.bio ?? ""} placeholder={tx("Kendinden bahset: hangi modları seversin, ne oynarsın…")} onChange={(e) => setD({ ...d, bio: e.target.value })} /></label>
        <div className="row" style={{ gap: 10 }}>
          <label className="field grow"><span>{tx("Konum")}</span><input value={d.location ?? ""} maxLength={40} onChange={(e) => setD({ ...d, location: e.target.value })} /></label>
          <label className="field grow"><span>{tx("Minecraft adı")}</span><input value={d.mc_username ?? ""} maxLength={16} onChange={(e) => setD({ ...d, mc_username: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })} /></label>
        </div>
        <label className="field"><span>{tx("Web sitesi")}</span><input value={d.website ?? ""} maxLength={200} placeholder="https://" onChange={(e) => setD({ ...d, website: e.target.value })} /></label>
        <div className="field">
          <span>{tx("Bağlantılar (YouTube, Twitch, Discord sunucusu…)")}</span>
          {links.map((l, i) => (
            <div key={i} className="row" style={{ gap: 6, marginTop: 6 }}>
              <input style={{ width: 140 }} value={l.label} placeholder={tx("Ad")} maxLength={30} onChange={(e) => setD({ ...d, links: links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input className="grow" value={l.url} placeholder="https://" onChange={(e) => setD({ ...d, links: links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <button className="icon-btn" onClick={() => setD({ ...d, links: links.filter((_, j) => j !== i) })}><X size={14} /></button>
            </div>
          ))}
          {links.length < 5 && <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setD({ ...d, links: [...links, { label: "", url: "" }] })}><Link2 size={13} /> {tx("Bağlantı ekle")}</button>}
        </div>
        {error && <p className="hint error">{error}</p>}
      </div>
    </Modal>
  );
}

// ───────── Mesajlar ─────────

function Avatar({ url, name, size = 42 }: { url?: string | null; name: string; size?: number }) {
  return url ? (
    <img className="s-avatar" src={url} alt="" style={{ width: size, height: size }} referrerPolicy="no-referrer" />
  ) : (
    <span className="s-avatar ph" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name.slice(0, 1).toUpperCase()}</span>
  );
}
