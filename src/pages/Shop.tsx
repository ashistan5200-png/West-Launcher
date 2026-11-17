import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Gamepad2, Lock, Sparkles } from "lucide-react";
import clsx from "clsx";
import { useWallet } from "@/stores/wallet";
import { CATEGORIES, FEATURED, IN_GAME_KINDS, kindVisible, meta, SLOT, type ShopItem, type ShopKind } from "@/lib/shop";
import { ShopPreview } from "@/components/ShopPreview";
import { PlusBadge, PlusMark } from "@/components/PlusBadge";
import { askConfirm } from "@/components/ConfirmDialog";
import { locale, tx } from "@/lib/i18n";

const fmt = (n: number) => n.toLocaleString(locale());

export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="coin-icon">
      <defs>
        <linearGradient id="wcg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="0.55" stopColor="#f2b654" />
          <stop offset="1" stopColor="#c8782c" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#wcg)" />
      <circle cx="12" cy="12" r="7.4" fill="none" stroke="#7a4a14" strokeOpacity="0.45" strokeWidth="1.2" />
      {/* Pusula iğnesi: West */}
      <g transform="rotate(-35 12 12)">
        <path d="M12 6.4 13.9 12h-3.8Z" fill="#5a3410" />
        <path d="M12 17.6 10.1 12h3.8Z" fill="#5a3410" fillOpacity="0.45" />
      </g>
    </svg>
  );
}

export function ShopPage() {
  const { view, load, buy, equip } = useWallet();
  const [cat, setCat] = useState<ShopKind | "featured">("featured");
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  useEffect(() => void load(), [load]);

  const items = useMemo(() => {
    const all = view?.catalog ?? [];
    if (cat === "featured") return FEATURED.map((id) => all.find((i) => i.id === id)).filter((x): x is ShopItem => !!x && kindVisible(x.kind)).slice(0, 8);
    return all.filter((i) => i.kind === cat);
  }, [view, cat]);

  if (!view) {
    return <div className="page shop-page"><p className="muted">{tx("Mağaza yükleniyor…")}</p></div>;
  }
  const w = view.wallet;
  const rate = view.plus ? (view.coinsPerHour * view.plusBonusPct) / 100 : view.coinsPerHour;
  // Sonraki coin'e kalan süre
  const secsPerCoin = 3600 / rate;
  const toNext = Math.max(0, Math.ceil(secsPerCoin - (w.carrySecs % secsPerCoin)));
  const plusUntil = w.plusUntil ? new Date(w.plusUntil) : null;

  const onBuy = async (it: ShopItem) => {
    const m = meta(it.id);
    if (!(await askConfirm(tx("{0} için {1} West Coin harcansın mı?", m.name, fmt(it.price))))) return;
    const err = await buy(it.id);
    if (err) return setMsg({ id: it.id, text: err, ok: false });
    setMsg({ id: it.id, text: it.kind === "plus" ? tx("West Plus açıldı! 🎉") : tx("Satın alındı! Hemen kuşanabilirsin."), ok: true });
    // Satın alınan görünüm hemen kuşanılsın (Plus hariç)
    if (it.kind !== "plus") await equip(SLOT[it.kind], it.id);
  };

  const onEquip = async (it: ShopItem, on: boolean) => {
    const err = await equip(SLOT[it.kind], on ? it.id : null);
    if (err) setMsg({ id: it.id, text: err, ok: false });
    else if (on && meta(it.id).inGame) setMsg({ id: it.id, text: tx("Kuşanıldı. Oyunu bir sonraki açışında görünür."), ok: true });
  };

  return (
    <div className="page shop-page">
      <header className="shop-hero">
        <div className="shop-hero-glow" aria-hidden />
        <div className="shop-balance">
          <span className="shop-eyebrow">{tx("West Coin bakiyen")}</span>
          <div className="shop-coins"><CoinIcon size={34} /> <strong>{fmt(w.coins)}</strong></div>
          <span className="muted small"><Clock size={13} /> {tx("Oynadığın her saat {0} coin · sonraki coin {1} sn sonra", fmt(rate), toNext)}</span>
        </div>
        <div className="shop-plus-box">
          {view.plus ? (
            <>
              <PlusBadge size={20} className="shine" />
              <span className="small">{tx("{0} tarihine kadar aktif", plusUntil?.toLocaleDateString(locale(), { day: "numeric", month: "long" }) ?? "")}</span>
              <span className="muted tiny">{tx("Saatte {0} coin kazanıyorsun", fmt(rate))}</span>
            </>
          ) : (
            <>
              <PlusMark size={30} />
              <strong>{tx("West Plus ile daha fazlası")}</strong>
              <span className="muted tiny">{tx("Plus logosu, Plus'a özel her şey ve saatte 150 coin.")}</span>
              <button className="btn btn-sm shop-plus-btn" onClick={() => setCat("plus")}>{tx("İncele")}</button>
            </>
          )}
        </div>
        <div className="shop-stats">
          <div><span className="muted tiny">{tx("Toplam kazanılan")}</span><strong>{fmt(w.earnedTotal)}</strong></div>
          <div><span className="muted tiny">{tx("Sahip olunan")}</span><strong>{w.owned.length}</strong></div>
        </div>
      </header>

      <nav className="shop-cats">
        {CATEGORIES.filter((c) => c.id === "featured" || kindVisible(c.id)).map((c) => (
          <button key={c.id} className={clsx("pill-tab", cat === c.id && "on")} onClick={() => setCat(c.id)}>
            {c.id === "plus" ? <PlusMark size={13} /> : null} {c.label}
          </button>
        ))}
      </nav>

      {cat !== "featured" && IN_GAME_KINDS.includes(cat) && (
        <p className="shop-note"><Gamepad2 size={14} /> {tx("Oyun içi öğeler West Companion yüklü Fabric 26.2 ve 1.21.11 instance'larında görünür. Şimdilik yalnızca sen görürsün (üçüncü şahıs görünümü ve envanter); diğer oyuncular göremez. Kuşandıktan sonra oyunu yeniden başlat.")}</p>
      )}

      <div className="shop-grid">
        {items.map((it) => {
          const m = meta(it.id);
          const owned = w.owned.includes(it.id) || (it.price === 0 && !it.plusOnly);
          const usable = owned || (it.plusOnly && view.plus);
          const on = w.equipped[SLOT[it.kind]] === it.id;
          const afford = w.coins >= it.price;
          return (
            <article key={it.id} className={clsx("shop-card", on && "equipped", it.plusOnly && "plus-only")}>
              <ShopPreview item={it} />
              <div className="shop-card-body">
                <div className="shop-card-top">
                  <strong className="truncate">{m.name}</strong>
                  {m.inGame && <span className="shop-tag"><Gamepad2 size={11} /> {tx("Oyunda")}</span>}
                </div>
                <p className="muted small">{m.desc}</p>
                <div className="shop-card-foot">
                  {it.kind === "plus" ? (
                    <span className="shop-price"><CoinIcon /> {fmt(it.price)}</span>
                  ) : it.plusOnly ? (
                    <span className="shop-price plus"><PlusMark size={14} /> {tx("Plus'a özel")}</span>
                  ) : owned ? (
                    <span className="shop-price owned"><Check size={14} /> {it.price === 0 ? tx("Hediye") : tx("Sende")}</span>
                  ) : (
                    <span className={clsx("shop-price", !afford && "short")}><CoinIcon /> {fmt(it.price)}</span>
                  )}
                  {it.kind === "plus" ? (
                    <button className="btn btn-primary btn-sm" disabled={!afford} onClick={() => void onBuy(it)}>{view.plus ? tx("Süreyi uzat") : tx("Al")}</button>
                  ) : usable ? (
                    <button className={clsx("btn btn-sm", on ? "btn-ghost" : "btn-primary")} onClick={() => void onEquip(it, !on)}>{on ? tx("Çıkar") : tx("Kuşan")}</button>
                  ) : it.plusOnly ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => setCat("plus")}><Lock size={13} /> {tx("Plus al")}</button>
                  ) : (
                    <button className="btn btn-primary btn-sm" disabled={!afford} title={afford ? undefined : tx("{0} coin daha gerekiyor", fmt(it.price - w.coins))} onClick={() => void onBuy(it)}>{tx("Satın al")}</button>
                  )}
                </div>
                {msg?.id === it.id && <p className={`hint ${msg.ok ? "ok" : "error"}`}>{msg.text}</p>}
              </div>
              {on && <span className="shop-on"><Sparkles size={11} /> {tx("Kuşanıldı")}</span>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
