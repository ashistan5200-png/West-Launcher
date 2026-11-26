import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronDown, Loader2, LogIn, Paintbrush, Pencil, Plus, RefreshCw, Rotate3d, Search, Star, Trash2, Upload, UserPlus, UserRound, X,
} from "lucide-react";
import clsx from "clsx";
import { useAccounts } from "@/stores/accounts";
import { SkinThumb } from "@/components/SkinThumb";
import type { PreviewAnim } from "@/components/SkinPreview3D";
import type { AccountView, Cape } from "@/lib/types";
import { api, isTauri } from "@/lib/ipc";
import { askConfirm } from "@/components/ConfirmDialog";
import { tx } from "@/lib/i18n";

const SkinPreview3D = lazy(() => import("@/components/SkinPreview3D"));
const SkinEditor = lazy(() => import("@/components/skin-editor/SkinEditor"));

const ANIMS: { id: PreviewAnim; label: string }[] = [
  { id: "idle", label: tx("Durağan") },
  { id: "pose", label: tx("Kahraman") },
  { id: "walk", label: tx("Yürü") },
  { id: "run", label: tx("Koş") },
  { id: "wave", label: tx("Selam") },
  { id: "crouch", label: tx("Eğil") },
];

/**
 * Skinler: solda büyük 3D önizleme, sağda seçili skinin eylemleri ve hesap seçici, altta arşiv.
 * Hesaplar ayrı bir sayfa değil; skin hangi hesaba uygulanacaksa oradan seçilir.
 */
export function SkinsPage() {
  const st = useAccounts();
  const { skins, previewId, accounts, busy, error, notice } = st;
  const active = accounts.find((a) => a.active) ?? null;
  const preview = skins.find((s) => s.id === previewId) ?? null;
  const [anim, setAnim] = useState<PreviewAnim>("idle");
  const [rotate, setRotate] = useState(true);
  const [filter, setFilter] = useState<"all" | "fav" | "used">("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<null | "new" | "edit">(null);

  useEffect(() => {
    void st.load().then(() => st.syncAccountSkin());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const gallery = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return skins.filter((s) =>
      (filter === "all" || (filter === "fav" ? s.favorite : accounts.some((a) => a.skinId === s.id))) &&
      (!q || s.name.toLocaleLowerCase().includes(q)));
  }, [skins, filter, query, accounts]);
  const appliedHere = !!preview && active?.skinId === preview.id;

  return (
    <div className="sk">
      <header className="rota-page-head">
        <div>
          <h1>{tx("Skinler")}</h1>
          <p>{skins.length === 0 ? tx("Arşivin boş") : tx("{0} skin arşivde", skins.length)}{active ? " · " + tx("{0} hesabıyla oynuyorsun", active.username) : ""}</p>
        </div>
        <div className="rota-actions">
          <button className="btn btn-ghost" disabled={busy === "import"} onClick={() => st.importFile()}>
            {busy === "import" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {tx("Dosyadan yükle")}
          </button>
          <button className="btn btn-primary" onClick={() => setEditor("new")}><Paintbrush size={15} /> {tx("Skin oluştur")}</button>
        </div>
      </header>

      <div className="sk-top">
        {/* ── Önizleme ── */}
        <section className="sk-stage">
          <div className="sk-stage-view">
            {preview ? (
              <Suspense fallback={<div className="skin-canvas" style={{ width: 280, height: 380 }} />}>
                <SkinPreview3D dataUrl={preview.dataUrl} slim={preview.slim} animation={anim} autoRotate={rotate} width={280} height={380} />
              </Suspense>
            ) : (
              <div className="sk-stage-empty">
                <UserRound size={40} />
                <strong>{tx("Henüz skin yok")}</strong>
                <span>{tx("Bilgisayarından bir .png yükle, bir oyuncunun skinini al ya da kendin çiz.")}</span>
              </div>
            )}
            <button className={clsx("sk-rotate", rotate && "on")} title={tx("Otomatik döndür")} aria-pressed={rotate} onClick={() => setRotate((v) => !v)}>
              <Rotate3d size={15} />
            </button>
          </div>
          <div className="sk-anims" role="tablist" aria-label={tx("Animasyon")}>
            {ANIMS.map((a) => (
              <button key={a.id} role="tab" aria-selected={anim === a.id} className={clsx(anim === a.id && "active")} onClick={() => setAnim(a.id)}>{a.label}</button>
            ))}
          </div>
        </section>

        {/* ── Seçili skin + hesap ── */}
        <div className="sk-side">
          <section className="sk-panel">
            <div className="sk-panel-head">
              <div className="grow">
                <span className="sk-label">{tx("Seçili skin")}</span>
                <h2 className="truncate">{preview ? preview.name : tx("Skin seç")}</h2>
              </div>
              {preview && (
                <div className="row">
                  <button className={clsx("icon-btn", preview.favorite && "fav")} title={preview.favorite ? tx("Favorilerden çıkar") : tx("Favorilere ekle")} onClick={() => st.toggleFavorite(preview)}>
                    <Star size={16} fill={preview.favorite ? "currentColor" : "none"} />
                  </button>
                  <button className="icon-btn" title={tx("Düzenle")} onClick={() => setEditor("edit")}><Pencil size={16} /></button>
                  <button className="icon-btn danger" title={tx("Arşivden sil")} onClick={async () => await askConfirm(tx("\"{0}\" arşivden silinsin mi?", preview.name)) && st.removeSkin(preview)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>

            {preview && (
              <div className="sk-field">
                <span>{tx("Kol modeli")}</span>
                <div className="sk-seg">
                  <button className={clsx(!preview.slim && "active")} onClick={() => st.setSlim(preview, false)}>{tx("Klasik")}</button>
                  <button className={clsx(preview.slim && "active")} onClick={() => st.setSlim(preview, true)}>{tx("İnce")}</button>
                </div>
              </div>
            )}

            <button className={clsx("btn btn-lg sk-apply", appliedHere ? "btn-ghost" : "btn-primary")} disabled={!preview || !active || busy === "apply" || appliedHere} onClick={() => preview && st.apply(preview)}>
              {busy === "apply" ? <Loader2 size={15} className="spin" /> : appliedHere ? <Check size={15} /> : <Upload size={15} />}
              {appliedHere ? tx("Bu hesapta kullanılıyor") : active ? tx("{0} hesabına uygula", active.username) : tx("Önce bir hesap ekle")}
            </button>
            {active?.kind === "offline" && (
              <p className="sk-note">{tx("Offline hesapta skin West Client'ta görünür; vanilla sunucularda oyun varsayılan skini gösterir.")}</p>
            )}
            {(error || notice) && <p className={clsx("sk-msg", error ? "error" : "ok")}>{error ?? notice}</p>}
          </section>

          <AccountSwitcher />
          <PlayerImport />
          {active?.kind === "microsoft" && <CapeStrip account={active} />}
        </div>
      </div>

      {/* ── Arşiv ── */}
      <section className="sk-archive">
        <div className="rota-section-head">
          <h2>{tx("Arşiv")}</h2>
          <div className="row">
            <div className="sk-tabs" role="tablist">
              {([["all", tx("Tümü")], ["fav", tx("Favoriler")], ["used", tx("Kullanılanlar")]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filter === k} className={clsx(filter === k && "active")} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <label className="sk-search">
              <Search size={14} />
              <input placeholder={tx("Skin ara")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
        </div>
        {gallery.length === 0 ? (
          <p className="sk-empty-line">
            {query ? tx("Eşleşen skin yok.") : filter === "fav" ? tx("Henüz favori skinin yok. Bir skini yıldızla işaretle.") : filter === "used" ? tx("Hiçbir hesapta kullanılan skin yok.") : tx("Yüklediğin ve kullandığın skinler burada birikir.")}
          </p>
        ) : (
          <div className="sk-grid">
            <button className="sk-tile sk-tile-new" onClick={() => setEditor("new")} title={tx("Skin oluştur")}>
              <Plus size={20} />
              <span>{tx("Yeni")}</span>
            </button>
            {gallery.map((s) => {
              const users = accounts.filter((a) => a.skinId === s.id);
              return (
                <button key={s.id} className={clsx("sk-tile", s.id === previewId && "selected")} onClick={() => st.setPreview(s.id)} title={s.name}>
                  <SkinThumb dataUrl={s.dataUrl} slim={s.slim} height={88} />
                  <span className="sk-tile-name truncate">{s.name}</span>
                  {s.favorite && <Star size={12} className="sk-tile-fav" fill="currentColor" />}
                  {users.length > 0 && <span className="sk-tile-use" title={users.map((u) => u.username).join(", ")}>{users[0].username}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {editor && (
        <Suspense fallback={null}>
          <SkinEditor
            initial={editor === "edit" ? preview : null}
            onClose={() => setEditor(null)}
            onSaved={async (skin, andApply) => {
              setEditor(null);
              await st.load();
              st.setPreview(skin.id);
              if (andApply && active) await st.apply(skin);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

/** Etkin hesap satırı; tıklayınca diğer hesaplar ve ekleme seçenekleri açılır */
function AccountSwitcher() {
  const { accounts, skins, setActive, remove, addOffline, startLogin, busy } = useAccounts();
  const active = accounts.find((a) => a.active) ?? null;
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const face = (a: AccountView, h: number) => {
    const s = skins.find((x) => x.id === a.skinId);
    return s ? <SkinThumb dataUrl={s.dataUrl} slim={s.slim} height={h} /> : <span className="sk-acc-blank" style={{ width: h / 2 + 8, height: h }}><UserRound size={14} /></span>;
  };

  return (
    <section className="sk-panel sk-acc" ref={box}>
      <span className="sk-label">{tx("Hesap")}</span>
      {active ? (
        <button className="sk-acc-current" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {face(active, 34)}
          <span className="grow">
            <strong className="truncate">{active.username}</strong>
            <span>{active.kind === "microsoft" ? "Microsoft" : tx("Offline")}{accounts.length > 1 ? " · " + tx("{0} hesap", accounts.length) : ""}</span>
          </span>
          <ChevronDown size={16} className={clsx("sk-chev", open && "open")} />
        </button>
      ) : (
        <p className="sk-note">{tx("Henüz hesap yok. Microsoft ile giriş yap ya da offline bir hesap ekle.")}</p>
      )}

      {(open || !active) && (
        <div className="sk-acc-menu">
          {accounts.filter((a) => !a.active).map((a) => (
            <div key={a.uuid} className="sk-acc-row">
              <button className="sk-acc-pick" onClick={() => { void setActive(a.uuid); setOpen(false); }}>
                {face(a, 26)}
                <span className="grow truncate">{a.username}</span>
                <span className="sk-acc-kind">{a.kind === "microsoft" ? "Microsoft" : tx("Offline")}</span>
              </button>
              <button className="icon-btn" title={tx("Kaldır")} onClick={async () => await askConfirm(tx("{0} hesabı kaldırılsın mı?", a.username)) && remove(a.uuid)}><X size={14} /></button>
            </div>
          ))}
          {active && (
            <button className="sk-acc-remove" onClick={async () => await askConfirm(tx("{0} hesabı kaldırılsın mı?", active.username)) && remove(active.uuid)}>
              <X size={13} /> {tx("{0} hesabını kaldır", active.username)}
            </button>
          )}
          {adding ? (
            <form className="sk-inline" onSubmit={async (e) => { e.preventDefault(); await addOffline(name); setName(""); setAdding(false); }}>
              <input autoFocus placeholder={tx("Kullanıcı adı (3–16, harf/rakam/_)")} value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn btn-primary btn-sm" disabled={!name.trim() || busy === "offline"}>{tx("Ekle")}</button>
            </form>
          ) : (
            <div className="sk-acc-add">
              <button className="btn btn-ghost btn-sm" onClick={startLogin}><LogIn size={14} /> {tx("Microsoft ile giriş")}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}><UserPlus size={14} /> {tx("Offline hesap")}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PlayerImport() {
  const { importPlayer, busy } = useAccounts();
  const [player, setPlayer] = useState("");
  return (
    <section className="sk-panel">
      <span className="sk-label">{tx("Oyuncudan al")}</span>
      <form className="sk-inline" onSubmit={(e) => { e.preventDefault(); if (player.trim()) void importPlayer(player.trim()).then(() => setPlayer("")); }}>
        <input placeholder={tx("Oyuncu adı (örn. AshiWest)")} value={player} onChange={(e) => setPlayer(e.target.value)} />
        <button className="btn btn-ghost btn-sm" disabled={!player.trim() || busy === "player"}>
          {busy === "player" ? <Loader2 size={14} className="spin" /> : tx("Al")}
        </button>
      </form>
    </section>
  );
}

function CapeStrip({ account }: { account: AccountView }) {
  const [capes, setCapes] = useState<Cape[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => isTauri() && api.accountCapes(account.uuid).then((c) => setCapes(Array.isArray(c) ? c : [])).catch(() => setCapes([]));
  useEffect(() => void load(), [account.uuid]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeCape = capes?.find((c) => c.state === "ACTIVE")?.id ?? null;

  return (
    <section className="sk-panel">
      <div className="sk-panel-head">
        <span className="sk-label grow">{tx("Pelerin")}</span>
        <button className="icon-btn" title={tx("Yenile")} onClick={() => void load()}><RefreshCw size={14} /></button>
      </div>
      {capes === null ? (
        <p className="sk-note"><Loader2 size={13} className="spin" /> {tx("Yükleniyor…")}</p>
      ) : capes.length === 0 ? (
        <p className="sk-note">{tx("Bu hesabın sahip olduğu bir pelerin yok.")}</p>
      ) : (
        <div className="sk-capes">
          {[{ id: null as string | null, alias: tx("Pelerin yok"), url: "" }, ...capes.map((c) => ({ id: c.id as string | null, alias: c.alias, url: c.url }))].map((c) => (
            <button
              key={c.id ?? "none"}
              className={clsx("sk-cape", activeCape === c.id && "selected")}
              disabled={busy}
              title={c.alias}
              onClick={async () => { setBusy(true); try { await api.setAccountCape(account.uuid, c.id); await load(); } finally { setBusy(false); } }}
            >
              {c.url ? <span className="cape-img" style={{ backgroundImage: `url(${c.url})` }} /> : <X size={16} />}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
