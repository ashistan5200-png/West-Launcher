import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useOnboarding } from "@/stores/onboarding";
import { useSettings } from "@/stores/settings";

/** Hızlı başlayıp güçlü yavaşlayan eğri — iğne "oturur" gibi durur. */
const SETTLE = [0.12, 0.85, 0.16, 1] as const;
const DURATION_MS = 2300;

/**
 * Sinematik açılış: pusula halkası belirir, iğne hızla dönüp ease-out ile
 * yavaşlayarak logodaki batı-eğik konumunda durur, ardından "West Client"
 * yazısı belirir ve ekran yumuşakça arayüze geçer. Tıklayınca atlanır.
 */
export function Splash() {
  const { splashDone, finishSplash } = useOnboarding();
  const reduce = useSettings((s) => s.settings.theme.reduceMotion);

  useEffect(() => {
    const t = window.setTimeout(finishSplash, reduce ? 500 : DURATION_MS);
    return () => window.clearTimeout(t);
  }, [finishSplash, reduce]);

  return (
    <AnimatePresence>
      {!splashDone && (
        <motion.div
          className="splash"
          onClick={finishSplash}
          exit={{ opacity: 0, scale: 1.015 }}
          transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          aria-label="West Client açılıyor"
        >
          <div className="splash-compass">
            <motion.svg
              viewBox="0 0 24 24"
              className="splash-ring"
              initial={{ opacity: 0, scale: 0.86 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <g opacity="0.55" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none">
                <circle cx="12" cy="12" r="10.4" />
                <path d="M12 1.6v2.1M12 20.3v2.1M1.6 12h2.1M20.3 12h2.1" />
              </g>
            </motion.svg>
            <motion.svg
              viewBox="0 0 24 24"
              className="splash-needle"
              initial={{ rotate: -1080 - 35, opacity: 0 }}
              animate={{ rotate: -35, opacity: 1 }}
              transition={{ rotate: { duration: reduce ? 0 : 1.6, ease: SETTLE, delay: 0.15 }, opacity: { duration: 0.25, delay: 0.15 } }}
            >
              <path d="M12 4.6 14.6 12H9.4L12 4.6Z" fill="rgb(var(--accent))" />
              <path d="M12 19.4 9.4 12h5.2L12 19.4Z" fill="currentColor" fillOpacity="0.38" />
              <circle cx="12" cy="12" r="1.35" fill="rgb(var(--bg))" stroke="currentColor" strokeOpacity="0.7" strokeWidth="0.9" />
            </motion.svg>
          </div>
          <motion.h1
            className="splash-title"
            initial={{ opacity: 0, y: 8, letterSpacing: "0.18em" }}
            animate={{ opacity: 1, y: 0, letterSpacing: "0.04em" }}
            transition={{ duration: 0.9, delay: reduce ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
          >
            West Client
          </motion.h1>
          <motion.span className="splash-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: reduce ? 0 : 1.5 }}>
            Rotanı belirle.
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
