import { useEffect, useLayoutEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AshiAvatar } from "./AshiAvatar";
import { useOnboarding } from "@/stores/onboarding";
import { LAUNCHER_LABEL } from "./ImportWizard";
import type { AshiMood } from "@/lib/ashi";
import { tx } from "@/lib/i18n";

interface Step {
  /** Kenar çubuğundaki hedef (data-tour); yoksa ekran ortası */
  target?: string;
  title: string;
  text: string;
  more: string;
  mood: AshiMood;
}

const STEPS: Step[] = [
  {
    title: tx("Selam, ben Ashi!"),
    text: tx("West Client'a hoş geldin. Sana birkaç dakikada her şeyi gezdireyim; istediğin an geçebilirsin."),
    more: tx("Ben bu launcher'ın rehberi ve iz sürücüsüyüm: mod bulurum, çöken paketlerde suçlu modu yakalarım, sorularını cevaplarım."),
    mood: "wave",
  },
  {
    target: "/library",
    title: tx("Kütüphane"),
    text: tx("Tüm instance'ların burada. Her biri kendi modları, ayarları ve dünyalarıyla tamamen ayrı."),
    more: tx("Vanilla, Fabric, Quilt, Forge ve NeoForge destekliyorum. Bir instance'ı klonlayabilir ya da şablon yapıp yeni paketlere temel olarak kullanabilirsin."),
    mood: "idle",
  },
  {
    target: "/browse",
    title: tx("Keşfet"),
    text: tx("Modrinth'teki on binlerce içeriği sürüme, yükleyiciye ve kategoriye göre süzerim. Mod, modpack, shader ve resource pack tek tıkla kurulur."),
    more: tx("Bir modun ihtiyaç duyduğu kütüphaneleri (Fabric API, Architectury…) kendim bulup kurarım; zaten kuruluysa atlarım."),
    mood: "search",
  },
  {
    target: "/skins",
    title: tx("Skin ve hesaplar"),
    text: tx("Microsoft ve offline hesapların, skin arşivin ve 3D önizleme burada."),
    more: tx("Bilgisayarından .png yükleyebilir, bir oyuncunun skinini alabilir, favorilerini saklayıp tek tıkla hesabına uygulayabilirsin."),
    mood: "think",
  },
  {
    target: "/gallery",
    title: tx("Ekran görüntüleri"),
    text: tx("Oyunda F2'ye bastığın an fotoğraf burada belirir. Kırp, filtre uygula, üzerine yaz."),
    more: tx("Düzenlemeler her zaman kopya olarak kaydedilir; orijinal dosyan hiç değişmez. Panoya kopyalayıp Discord'a yapıştırabilirsin."),
    mood: "celebrate",
  },
  {
    target: "ashi",
    title: tx("Bana her zaman sorabilirsin"),
    text: tx("\"Korku-aksiyon modpack öner\" gibi yaz; arayıp kurulabilir öneriler getiririm."),
    more: tx("Varsayılan olarak bilgisayarında çalışan ücretsiz bir yapay zeka kullanırım. Ayarlardan değiştirebilirsin."),
    mood: "wave",
  },
];

const AVATAR_W = 108;
const AVATAR_H = 136;

function anchor(target?: string) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const el = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
  if (!el) return { x: vw / 2 - AVATAR_W - 40, y: vh / 2 - AVATAR_H / 2 - 20, rect: null as DOMRect | null };
  const r = el.getBoundingClientRect();
  return { x: r.right + 18, y: Math.min(Math.max(12, r.top + r.height / 2 - AVATAR_H / 2), vh - AVATAR_H - 150), rect: r };
}

export function AshiTour() {
  const { touring, endTour, openWizard, found, scanning } = useOnboarding();
  const [i, setI] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const [pos, setPos] = useState(() => anchor());
  const isImport = i === STEPS.length;
  const step = STEPS[Math.min(i, STEPS.length - 1)];

  useLayoutEffect(() => {
    if (!touring) return;
    const update = () => setPos(anchor(isImport ? undefined : step.target));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [touring, i, isImport, step.target]);

  useEffect(() => setShowMore(false), [i]);

  if (!touring) return null;

  const launchers = [...new Set((found ?? []).map((f) => f.launcher))].map((l) => LAUNCHER_LABEL[l]);
  const next = () => setI((n) => n + 1);
  const finish = () => void endTour();

  const title = isImport ? tx("Son bir şey") : step.title;
  const text = isImport
    ? scanning && !found
      ? tx("Bilgisayarında başka launcher var mı diye bakıyorum…")
      : launchers.length
        ? tx("Bilgisayarında {0} tespit ettim ({1} instance). Mevcut modpack'lerini ve ayarlarını West Client'a hemen aktarmak ister misin?", launchers.join(", "), found!.length)
        : tx("Başka bir launcher bulamadım. İleride Kütüphane'den bir klasör seçip aktarım yapabilirsin.")
    : step.text;
  const mood: AshiMood = isImport ? (launchers.length ? "think" : "wave") : step.mood;

  return (
    <div className="tour-layer" role="dialog" aria-label={tx("Ashi tanıtım turu")}>
      {/* Odak: hedef dışını hafifçe karartan, hedefe kayan çerçeve */}
      <AnimatePresence>
        {pos.rect && !isImport && (
          <motion.div
            key="spot"
            className="tour-spot"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, left: pos.rect.left - 6, top: pos.rect.top - 6, width: pos.rect.width + 12, height: pos.rect.height + 12 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 160, damping: 22 }}
          />
        )}
      </AnimatePresence>
      {(!pos.rect || isImport) && <motion.div className="tour-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />}

      {/* Ashi: sahneye uçarak girer, adımlar arasında süzülür */}
      <motion.div
        className="tour-ashi"
        initial={{ x: window.innerWidth + 40, y: -AVATAR_H, rotate: -12 }}
        animate={{ x: pos.x, y: pos.y, rotate: 0 }}
        transition={{ type: "spring", stiffness: 55, damping: 13, mass: 1.1 }}
      >
        <div className="tour-float">
          <AshiAvatar mood={mood} width={AVATAR_W} height={AVATAR_H} />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={i}
            className="tour-bubble"
            initial={{ opacity: 0, x: -8, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          >
            <div className="tour-head">
              <strong>{title}</strong>
              <span className="tour-dots">
                {[...STEPS, null].map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}
              </span>
            </div>
            <p>{text}</p>
            <AnimatePresence>
              {showMore && !isImport && (
                <motion.p className="tour-more" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  {step.more}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="tour-actions">
              {isImport ? (
                launchers.length ? (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => { finish(); openWizard(); }}>{tx("Evet, aktaralım")}</button>
                    <button className="btn btn-ghost btn-sm" onClick={finish}>{tx("Şimdilik geç")}</button>
                  </>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={scanning && !found} onClick={finish}>{tx("Hadi başlayalım")}</button>
                )
              ) : (
                <>
                  <button className="btn btn-primary btn-sm" onClick={next}>{tx("Devam et")}</button>
                  {!showMore && <button className="btn btn-ghost btn-sm" onClick={() => setShowMore(true)}>{tx("Bu ne işe yarıyor?")}</button>}
                  <button className="btn-link" onClick={finish}>{tx("Anladım, geç")}</button>
                </>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
