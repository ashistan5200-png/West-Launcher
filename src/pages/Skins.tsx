import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, Loader2, LogIn, RefreshCw, Rotate3d, Star, Trash2, Upload, UserPlus, UserRound, X,
} from "lucide-react";
import clsx from "clsx";
import { useAccounts } from "@/stores/accounts";
import { SkinThumb } from "@/components/SkinThumb";
import { WestAccountCard } from "@/components/WestAccountCard";
import type { PreviewAnim } from "@/components/SkinPreview3D";
import type { AccountView, Cape } from "@/lib/types";
import { api, isTauri } from "@/lib/ipc";
import { askConfirm } from "@/components/ConfirmDialog";
import { tx } from "@/lib/i18n";

const SkinPreview3D = lazy(() => import("@/components/SkinPreview3D"));

const ANIMS: { id: PreviewAnim; label: string }[] = [
  { id: "idle", label: tx("Durağan") },
  { id: "pose", label: tx("Kahraman") },
  { id: "walk", label: tx("Yürü") },
  { id: "run", label: tx("Koş") },
  { id: "wave", label: tx("Selam") },
  { id: "crouch", label: tx("Eğil") },
];

export function SkinsPage() {
  const st = useAccounts();
  const { skins, previewId, accounts, busy, error, notice } = st;
  const active = accounts.find((a) => a.active) ?? null;
  const preview = skins.find((s) => s.id === previewId) ?? null;
  const [anim, setAnim] = useState<PreviewAnim>("idle");
  const [rotate, setRotate] = useState(true);
  const [onlyFav, setOnlyFav] = useState(false);
  const [player, setPlayer] = useState("");

  useEffect(() => {
    void st.load().then(() => st.syncAccountSkin());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const gallery = useMemo(() => (onlyFav ? skins.filter((s) => s.favorite) : skins), [skins, onlyFav]);
  const appliedHere = !!preview && active?.skinId === preview.id;

  return (
    <div className="skins-page">
      {/* ── Sol: 3D önizleme ── */}
      <section className="card skin-stage">
        <div className="skin-stage-view">
          {preview ? (
            <Suspense fallback={<div className="skin-canvas" style={{ width: 300, height: 420 }} />}>
              <SkinPreview3D dataUrl={preview.dataUrl} slim={preview.slim} animation={anim} autoRotate={rotate} width={300} height={420} />
            </Suspense>
          ) : (
            <div className="skin-empty">
              <UserRound size={42} />
              <p>{tx("Arşivinde henüz skin yok. Bilgisayarından bir .png yükle ya da bir oyuncunun skinini al.")}</p>
            </div>
          )}
        </div>
        <div className="segmented wrap">
          {ANIMS.map((a) => (
            <button key={a.id} className={clsx(anim === a.id && "active")} onClick={() => setAnim(a.id)}>{a.label}</button>
          ))}
        </div>
        <div className="row between">
          <label className="check"><input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} /> <Rotate3d size={14} /> {tx("Otomatik döndür")}</label>
          {preview && (
            <div className="segmented mini" title={tx("Kol modeli")}>
              <button className={clsx(!preview.slim && "active")} onClick={() => st.setSlim(preview, false)}>{tx("Klasik")}</button>
              <button className={clsx(preview.slim && "active")} onClick={() => st.setSlim(preview, true)}>{tx("İnce")}</button>
            </div>
          )}
        </div>
        <p className="muted tiny center">{tx("Sürükleyerek döndür · tekerlekle yakınlaştır")}</p>
      </section>

      {/* ── Sağ: hesap + eylemler ── */}
      <div className="stack">
        <WestAccountCard />
        <AccountCard />

        <section className="card stack">
          <div className="section-head">
            <h3>{preview ? preview.name : tx("Skin seç")}</h3>
            {preview && (
              <div className="row">
                <button className={clsx("icon-btn", preview.favorite && "fav")} title={tx("Favori")} onClick={() => st.toggleFavorite(preview)}>
                  <Star size={16} fill={preview.favorite ? "currentColor" : "none"} />
                </button>
                <button className="icon-btn" title={tx("Arşivden sil")} onClick={async () => await askConfirm(tx("\"{0}\" arşivden silinsin mi?", preview.name)) && st.removeSkin(preview)}>
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
          <button className="btn btn-primary" disabled={!preview || !active || busy === "apply" || appliedHere} onClick={() => preview && st.apply(preview)}>
            {busy === "apply" ? <Loader2 size={15} className="spin" /> : appliedHere ? <Check size={15} /> : <Upload size={15} />}
            {appliedHere ? tx("Bu hesapta kullanılıyor") : active ? tx("{0} hesabına uygula", active.username) : tx("Önce bir hesap ekle")}
          </button>
          {active?.kind === "offline" && (
            <p className="muted tiny">{tx("Offline hesaplarda skin launcher'da saklanır; oyunda görünmesi West Companion oyun içi modu ile gelecek. Vanilla offline modda oyun varsayılan skini gösterir.")}</p>
          )}

          <div className="divider" />
          <button className="btn btn-ghost" disabled={busy === "import"} onClick={() => st.importFile()}>
            {busy === "import" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {tx("Bilgisayardan yükle (.png)")}
          </button>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (player.trim()) void st.importPlayer(player.trim()).then(() => setPlayer("")); }}>
            <input placeholder={tx("Oyuncu adından al (örn. AshiWest)")} value={player} onChange={(e) => setPlayer(e.target.value)} />
            <button className="btn btn-ghost btn-sm" disabled={!player.trim() || busy === "player"}>
              {busy === "player" ? <Loader2 size={14} className="spin" /> : tx("Al")}
            </button>
          </form>

          <AnimatePresence>
            {(error || notice) && (
              <motion.p key={error ?? notice} className={clsx("hint", error ? "error" : "ok")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {error ?? notice}
              </motion.p>
            )}
          </AnimatePresence>
        </section>

        {active?.kind === "microsoft" && <CapeCard account={active} />}
      </div>

      {/* ── Alt: arşiv ── */}
      <section className="card stack skins-archive">
        <div className="section-head">
          <h3>{tx("Skin arşivi")} <span className="muted tiny">({skins.length})</span></h3>
          <div className="pills">
            <button className={clsx("pill", !onlyFav && "active")} onClick={() => setOnlyFav(false)}>{tx("Tümü")}</button>
            <button className={clsx("pill", onlyFav && "active")} onClick={() => setOnlyFav(true)}><Star size={12} /> {tx("Favoriler")}</button>
          </div>
        </div>
        {gallery.length === 0 ? (
          <p className="muted small">{onlyFav ? tx("Henüz favori skinin yok. Bir skini yıldızla işaretle.") : tx("Yüklediğin ve kullandığın skinler burada birikir.")}</p>
        ) : (
          <div className="skin-grid">
            {gallery.map((s) => (
              <button key={s.id} className={clsx("skin-tile", s.id === previewId && "selected")} onClick={() => st.setPreview(s.id)} title={s.name}>
                <SkinThumb dataUrl={s.dataUrl} slim={s.slim} height={84} />
                <span className="skin-name truncate">{s.name}</span>
                {s.favorite && <Star size={12} className="skin-fav" fill="currentColor" />}
                {accounts.some((a) => a.skinId === s.id) && <span className="skin-in-use" title={tx("Bir hesapta kullanılıyor")} />}
              </button>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}

function AccountCard() {
  const { accounts, setActive, remove, addOffline, startLogin, busy } = useAccounts();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  return (
    <section className="card stack">
      <div className="section-head">
        <h3>{tx("Hesaplar")}</h3>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding((v) => !v)}><UserPlus size={14} /> {tx("Offline")}</button>
          <button className="btn btn-primary btn-sm" onClick={startLogin}><LogIn size={14} /> {tx("Microsoft")}</button>
        </div>
      </div>
      {adding && (
        <form className="row" onSubmit={async (e) => { e.preventDefault(); await addOffline(name); setName(""); setAdding(false); }}>
          <input autoFocus placeholder={tx("Kullanıcı adı (3–16, harf/rakam/_)")} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={!name.trim() || busy === "offline"}>{tx("Ekle")}</button>
        </form>
      )}
      {accounts.length === 0 ? (
        <p className="muted small">{tx("Henüz hesap yok. Microsoft ile giriş yap veya bir offline hesap ekle.")}</p>
      ) : (
        <ul className="account-list">
          {accounts.map((a) => (
            <AccountRow key={a.uuid} a={a} onSelect={() => setActive(a.uuid)} onRemove={async () => await askConfirm(tx("{0} hesabı kaldırılsın mı?", a.username)) && remove(a.uuid)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AccountRow({ a, onSelect, onRemove }: { a: AccountView; onSelect: () => void; onRemove: () => void }) {
  const skins = useAccounts((s) => s.skins);
  const skin = skins.find((s) => s.id === a.skinId);
  return (
    <li className={clsx("account-row", a.active && "active")}>
      <button className="account-main" onClick={onSelect}>
        {skin ? <SkinThumb dataUrl={skin.dataUrl} slim={skin.slim} height={34} /> : <span className="account-blank"><UserRound size={16} /></span>}
        <span className="grow">
          <strong>{a.username}</strong>
          <span className="muted tiny">{a.kind === "microsoft" ? tx("Microsoft") : tx("Offline")}{a.active ? tx(" · etkin") : ""}</span>
        </span>
        {a.active && <Check size={15} className="accent" />}
      </button>
      <button className="icon-btn" title={tx("Kaldır")} onClick={onRemove}><X size={14} /></button>
    </li>
  );
}

function CapeCard({ account }: { account: AccountView }) {
  const [capes, setCapes] = useState<Cape[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => isTauri() && api.accountCapes(account.uuid).then(setCapes).catch(() => setCapes([]));
  useEffect(() => void load(), [account.uuid]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeCape = capes?.find((c) => c.state === "ACTIVE")?.id ?? null;

  return (
    <section className="card stack">
      <div className="section-head">
        <h3>{tx("Pelerin")}</h3>
        <button className="icon-btn" title={tx("Yenile")} onClick={() => void load()}><RefreshCw size={14} /></button>
      </div>
      {capes === null ? (
        <p className="muted small"><Loader2 size={13} className="spin" /> {tx("Yükleniyor…")}</p>
      ) : capes.length === 0 ? (
        <p className="muted small">{tx("Bu hesabın sahip olduğu bir pelerin yok.")}</p>
      ) : (
        <div className="cape-grid">
          {[{ id: null as string | null, alias: tx("Pelerin yok"), url: "" }, ...capes.map((c) => ({ id: c.id as string | null, alias: c.alias, url: c.url }))].map((c) => (
            <button
              key={c.id ?? "none"}
              className={clsx("cape-tile", activeCape === c.id && "selected")}
              disabled={busy}
              onClick={async () => { setBusy(true); try { await api.setAccountCape(account.uuid, c.id); await load(); } finally { setBusy(false); } }}
            >
              {c.url ? <span className="cape-img" style={{ backgroundImage: `url(${c.url})` }} /> : <X size={18} />}
              <span className="tiny truncate">{c.alias}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

