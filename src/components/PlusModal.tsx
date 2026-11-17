import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Check, ExternalLink, KeyRound, Sparkles, X } from "lucide-react";
import { PlusMark } from "@/components/PlusBadge";
import { PLUS_PLANS, PLUS_STORE_URL, usePlus } from "@/stores/plus";
import { useWest } from "@/stores/west";
import { locale, tx } from "@/lib/i18n";

/** West+ ayrıcalıkları. "soon": henüz yok, dürüstçe "Yakında" yazılır. */
const PERKS: { text: string; soon?: boolean }[] = [
  { text: tx("Açılış ekranında ve başlıkta West+ logosu") },
  { text: tx("West'e özel pelerinler, kanatlar ve şapkalar"), soon: true },
  { text: tx("Kendi sunucularımızla daha hızlı dünya paylaşımı"), soon: true },
  { text: tx("Bulut yedekleme: dünyaların her bilgisayarda"), soon: true },
  { text: tx("Ashi Pro: kurulum gerektirmeyen daha akıllı Ashi"), soon: true },
  { text: tx("Her ay abonelere özel bir kozmetik"), soon: true },
];

/** Kodu yazarken WEST-XXXX-XXXX-XXXX-XXXX biçimine sok */
function formatCode(v: string) {
  const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^WEST/, "").slice(0, 16);
  const groups = raw.match(/.{1,4}/g) ?? [];
  return raw ? ["WEST", ...groups].join("-") : "";
}

export function PlusModal() {
  const { modalOpen, closeModal, active, expiresAt, redeem } = usePlus();
  const west = useWest((s) => s.account);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    if (busy || code.replace(/[^A-Z0-9]/g, "").length < 20) return;
    setBusy(true);
    setMsg(null);
    const r = await redeem(code);
    setBusy(false);
    if (r.ok) {
      setCode("");
      setMsg({ ok: true, text: tx("Kod kullanıldı! West+ {0} gün uzadı. 🎉", r.days) });
    } else setMsg({ ok: false, text: r.error });
  };

  const until = expiresAt ? new Date(expiresAt).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" }) : "";

  return (
    <AnimatePresence>
      {modalOpen && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={closeModal}>
          <motion.div
            className="modal plus-modal"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="West Plus"
          >
            <button className="icon-btn plus-close" onClick={closeModal} aria-label={tx("Kapat")}><X size={16} /></button>
            <div className="plus-hero">
              <div className="plus-hero-glow" aria-hidden />
              <PlusMark size={54} />
              <h2>West <span className="plus-gold">Plus</span></h2>
              {active ? (
                <p className="plus-status on"><Check size={14} /> {tx("West+ aktif · {0} tarihine kadar", until)}</p>
              ) : (
                <p className="plus-status">{tx("West Client'ı destekle, ayrıcalıkları aç.")}</p>
              )}
            </div>

            <div className="plus-body">
              <ul className="plus-perks">
                {PERKS.map((p) => (
                  <li key={p.text}>
                    <Sparkles size={14} />
                    <span className="grow">{p.text}</span>
                    {p.soon && <span className="plus-soon">{tx("Yakında")}</span>}
                  </li>
                ))}
              </ul>

              <div className="plus-plans">
                {PLUS_PLANS.map((p) => (
                  <div key={p.id} className={`plus-plan${p.id === "year" ? " best" : ""}`}>
                    {p.id === "year" && <span className="plus-ribbon">{tx("En avantajlı")}</span>}
                    <span className="plus-plan-name">{p.label}</span>
                    <strong>{p.price} <small>TL</small></strong>
                    <span className="muted tiny">{p.note || tx("{0} gün", p.days)}</span>
                  </div>
                ))}
              </div>

              <button className="btn btn-primary plus-buy" disabled={!PLUS_STORE_URL} onClick={() => PLUS_STORE_URL && void openUrl(PLUS_STORE_URL)}>
                {PLUS_STORE_URL ? <><ExternalLink size={15} /> {tx("Kod satın al")}</> : tx("Satış çok yakında açılıyor")}
              </button>
              <p className="muted tiny plus-how">{tx("Kodu satın aldıktan sonra aşağıya yaz; West+ anında hesabına tanımlanır. Süren bitmeden yeni kod kullanırsan üstüne eklenir.")}</p>

              <div className="plus-redeem">
                <KeyRound size={16} />
                <input
                  value={code}
                  placeholder="WEST-XXXX-XXXX-XXXX-XXXX"
                  spellCheck={false}
                  disabled={!west || busy}
                  onChange={(e) => setCode(formatCode(e.target.value))}
                  onKeyDown={(e) => e.key === "Enter" && void submit()}
                  aria-label={tx("West+ kodu")}
                />
                <button className="btn btn-primary btn-sm" disabled={!west || busy || code.replace(/[^A-Z0-9]/g, "").length < 20} onClick={() => void submit()}>
                  {busy ? tx("Kontrol ediliyor…") : tx("Kodu kullan")}
                </button>
              </div>
              {!west && <p className="hint warn">{tx("Kod kullanmak için önce Sosyal sekmesinden West hesabına giriş yap.")}</p>}
              {msg && <p className={`hint ${msg.ok ? "ok" : "error"}`}>{msg.text}</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
