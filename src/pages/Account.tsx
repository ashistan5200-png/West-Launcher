import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck, Bell, Bookmark, CalendarDays, ExternalLink, Globe2, KeyRound, Loader2, LogOut, Mail, MailCheck, MapPin, MessageCircle,
  Pencil, Shield, Shirt, UserRound,
} from "lucide-react";
import clsx from "clsx";
import { useWest } from "@/stores/west";
import { useSocial } from "@/stores/social";
import { useAccounts } from "@/stores/accounts";
import { WestAccountCard } from "@/components/WestAccountCard";
import { EditProfileModal } from "@/pages/Social";
import { askConfirm } from "@/components/ConfirmDialog";
import { api, isTauri } from "@/lib/ipc";
import { formatCount } from "@/lib/format";
import { locale, tx } from "@/lib/i18n";

/**
 * West hesabı: başlık çubuğundaki hesap adından açılır. Sosyal profille aynı veriyi (fotoğraf, banner,
 * biyografi, takipçiler) gösterir ve düzenler; e-posta, şifre, oturum ve Minecraft hesapları da burada.
 */
export function AccountPage() {
  const navigate = useNavigate();
  const { account, loaded, load, logout } = useWest();
  const { me, loadMe, setMe, unread, refreshUnread } = useSocial();
  const mcAccounts = useAccounts((s) => s.accounts);
  const [editing, setEditing] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);
  useEffect(() => {
    if (account) { void loadMe(); void refreshUnread(); }
  }, [account, loadMe, refreshUnread]);
  useEffect(() => { if (isTauri()) void useAccounts.getState().load(); }, []);

  if (loaded && !account) {
    return (
      <div className="page acc-page">
        <div className="acc-gate">
          <h1>{tx("West hesabı")}</h1>
          <p className="muted">{tx("Profilin, sosyal ağ, arkadaşların ve ayarların tek hesapta; her bilgisayarda aynı.")}</p>
          <div style={{ width: "min(460px, 100%)" }}><WestAccountCard /></div>
        </div>
      </div>
    );
  }
  if (!account) return <div className="page acc-page"><p className="muted"><Loader2 size={14} className="spin" /> {tx("Yükleniyor…")}</p></div>;

  const name = me?.display_name || account.username;
  const resetPassword = async () => {
    setBusy(true);
    setResetMsg(null);
    try {
      await api.westResetPassword(account.email);
      setResetMsg(tx("Şifre sıfırlama bağlantısı {0} adresine gönderildi.", account.email));
    } catch (e) {
      setResetMsg(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  };
  const doLogout = async () => {
    if (await askConfirm(tx("West hesabından çıkış yapılsın mı?"), { danger: false, confirmLabel: tx("Çıkış yap") })) {
      await logout();
      navigate("/");
    }
  };

  return (
    <div className="page acc-page">
      <section className="acc-hero">
        <div className="acc-banner">{me?.banner_url ? <img src={me.banner_url} alt="" /> : <div className="acc-banner-ph" />}</div>
        <div className="acc-hero-body">
          {me?.avatar_url ? <img className="acc-avatar" src={me.avatar_url} alt="" /> : <span className="acc-avatar ph">{name.slice(0, 1).toUpperCase()}</span>}
          <div className="acc-id">
            <h1>{name}{me?.verified && <BadgeCheck size={20} className="s-verified" />}</h1>
            <span className="muted">@{account.username}</span>
            {me?.bio && <p className="acc-bio">{me.bio}</p>}
            <div className="acc-meta muted small">
              {me?.location && <span><MapPin size={13} /> {me.location}</span>}
              {me?.website && <span><Globe2 size={13} /> {me.website.replace(/^https?:\/\//, "")}</span>}
              {me?.created_at && <span><CalendarDays size={13} /> {tx("{0} tarihinde katıldı", new Date(me.created_at).toLocaleDateString(locale(), { month: "long", year: "numeric" }))}</span>}
            </div>
            {me && (
              <div className="acc-counts">
                <button onClick={() => navigate(`/u/${account.username}`)}><strong>{formatCount(me.posts_count)}</strong> {tx("gönderi")}</button>
                <button onClick={() => navigate(`/u/${account.username}`)}><strong>{formatCount(me.followers_count)}</strong> {tx("takipçi")}</button>
                <button onClick={() => navigate(`/u/${account.username}`)}><strong>{formatCount(me.following_count)}</strong> {tx("takip")}</button>
              </div>
            )}
          </div>
          <div className="acc-actions">
            {me && <button className="btn btn-primary" onClick={() => setEditing(true)}><Pencil size={15} /> {tx("Profili düzenle")}</button>}
            <button className="btn btn-ghost" onClick={() => navigate(`/u/${account.username}`)}><ExternalLink size={15} /> {tx("Sosyal profilini gör")}</button>
          </div>
        </div>
      </section>

      <div className="acc-grid">
        <section className="card acc-card">
          <h3><UserRound size={16} /> {tx("Hesap")}</h3>
          <div className="acc-row"><span className="muted small">{tx("Kullanıcı adı")}</span><strong>{account.username}</strong></div>
          <div className="acc-row"><span className="muted small">{tx("E-posta")}</span><strong className="truncate">{account.email}</strong></div>
          <div className="acc-row">
            <span className="muted small">{tx("Doğrulama")}</span>
            {account.emailConfirmed ? <span className="west-ok"><MailCheck size={13} /> {tx("E-posta doğrulandı")}</span> : <span className="west-warn"><Mail size={13} /> {tx("E-posta doğrulanmadı")}</span>}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void resetPassword()}>{busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {tx("Şifremi değiştir")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => void doLogout()}><LogOut size={14} /> {tx("Çıkış yap")}</button>
          </div>
          {resetMsg && <p className="muted small">{resetMsg}</p>}
        </section>

        <section className="card acc-card">
          <h3><MessageCircle size={16} /> {tx("Sosyal")}</h3>
          <div className="acc-links">
            <button onClick={() => navigate("/social/notifications")}><Bell size={16} /> {tx("Bildirimler")} {unread.notifications > 0 && <em className="nav-badge static">{unread.notifications}</em>}</button>
            <button onClick={() => navigate("/social/messages")}><Mail size={16} /> {tx("Mesajlar")} {unread.messages > 0 && <em className="nav-badge static">{unread.messages}</em>}</button>
            <button onClick={() => navigate("/social/bookmarks")}><Bookmark size={16} /> {tx("Yer imleri")}</button>
            <button onClick={() => navigate("/social/settings")}><Shield size={16} /> {tx("Gizlilik")}</button>
          </div>
        </section>

        <section className="card acc-card">
          <h3><Shirt size={16} /> {tx("Minecraft hesapları")}</h3>
          {mcAccounts.length === 0 ? <p className="muted small">{tx("Henüz Minecraft hesabı eklenmedi.")}</p> : mcAccounts.map((a) => (
            <div key={a.uuid} className={clsx("acc-mc", a.active && "on")}>
              <img src={`https://mc-heads.net/avatar/${a.uuid}/32`} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
              <strong className="truncate">{a.username}</strong>
              <span className={`tb-kind ${a.kind}`}>{a.kind === "microsoft" ? "Microsoft" : tx("Offline")}</span>
              {a.active && <span className="chip chip-accent">{tx("Etkin")}</span>}
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => navigate("/skins")}><Shirt size={14} /> {tx("Skin ve hesaplar")}</button>
        </section>
      </div>

      {me && <EditProfileModal open={editing} onClose={() => setEditing(false)} profile={me} onSaved={(p) => { setMe(p); setEditing(false); }} />}
    </div>
  );
}
