import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Import, Loader2, LogIn, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import clsx from "clsx";
import { AshiAvatar } from "./AshiAvatar";
import { Logo } from "./Logo";
import { useOnboarding } from "@/stores/onboarding";
import { useAccounts } from "@/stores/accounts";
import { useSettings } from "@/stores/settings";
import { api, isTauri } from "@/lib/ipc";
import type { AshiMood } from "@/lib/ashi";
import { LAUNCHER_LABEL } from "./ImportWizard";
import { tx } from "@/lib/i18n";

const STEPS = ["welcome", "login", "import", "done"] as const;
type Step = (typeof STEPS)[number];

const CARD_W = 420;
const AVATAR_W = 112;
const AVATAR_H = 140;
/** Oturan Ashi'nin kalçası tuvalin bu oranında; kartın üst kenarına oturtulur */
const SEAT_RATIO = 0.62;
const FACE_FRONT = -0.42;
const FACE_RIGHT = Math.PI / 2;
const FACE_LEFT = -Math.PI / 2;

/** Kartlar zikzak dizilir; Ashi aralarında koşar. */
function cardOffset(i: number, stageW: number) {
  const room = Math.max(0, (stageW - CARD_W) / 2 - 12);
  const amp = Math.min(110, room);
  return i % 2 === 0 ? -amp : amp;
}

/** Göz düğmeli şifre alanı. `onReveal` ile maskot tepki verir. */
export function PasswordField({ id, value, onChange, visible, onToggle, placeholder, autoFocus, onEnter }: {
  id: string; value: string; onChange: (v: string) => void; visible: boolean; onToggle: () => void;
  placeholder?: string; autoFocus?: boolean; onEnter?: () => void;
}) {
  return (
    <div className="pw-field">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        autoComplete="new-password"
        spellCheck={false}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      />
      <button type="button" className="pw-eye" onClick={onToggle} aria-label={visible ? tx("Şifreyi gizle") : tx("Şifreyi göster")} aria-pressed={visible}>
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export function SetupWizard() {
  const { setupOpen, finishSetup, found, scanning } = useOnboarding();
  const accounts = useAccounts((s) => s.accounts);
  const { startLogin, loginOpen, addOffline } = useAccounts();
  const offlineDefault = useSettings((s) => s.offlineName);

  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [mood, setMood] = useState<AshiMood>("sit");
  const [facing, setFacing] = useState(FACE_FRONT);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pwVisible, setPwVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tour, setTour] = useState(true);
  const [importAfter, setImportAfter] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(900);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);

  const step: Step = STEPS[i];
  const hasAccount = accounts.length > 0;
  const launchers = useMemo(() => [...new Set((found ?? []).map((f) => f.launcher))].map((l) => LAUNCHER_LABEL[l]), [found]);

  useEffect(() => {
    if (!setupOpen) return;
    const measure = () => setStageW(stageRef.current?.clientWidth ?? 900);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [setupOpen]);

  // Ashi'nin oturduğu yer: o anki kartın ortası
  useEffect(() => {
    if (!moving) mx.set(cardOffset(i, stageW));
  }, [i, stageW, moving, mx]);

  // Şifre alanına tepki: gizliyken gözler kapalı, gösterilince gizlice bakış
  useEffect(() => {
    if (moving) return;
    if (step === "login") setMood(pwVisible ? "sit-peek" : "sit-cover");
    else setMood(step === "done" ? "sit-wave" : "sit");
  }, [step, pwVisible, moving]);

  if (!setupOpen) return null;

  /** Kart değişimi + koşu koreografisi */
  const go = async (to: number) => {
    if (moving || to < 0 || to >= STEPS.length) return;
    const d = to > i ? 1 : -1;
    const from = cardOffset(i, stageW);
    const target = cardOffset(to, stageW);
    const reduce = useSettings.getState().settings.theme.reduceMotion;
    setDir(d);
    setPwVisible(false);
    setError(null);
    if (reduce) {
      setI(to);
      return;
    }
    setMoving(true);
    // 1) ayağa kalk, hedefe dön, küçük bir sıçrayışla karttan in
    setMood("jump");
    setFacing(target >= from ? FACE_RIGHT : FACE_LEFT);
    await animate(my, [0, -14, 6], { duration: 0.28, ease: "easeOut" });
    // 2) eski kart kaybolur, yenisi açılırken koş
    setI(to);
    setMood("run");
    const dist = Math.abs(target - from);
    await animate(mx, target - (target >= from ? 18 : -18), { duration: Math.max(0.45, dist / 380), ease: "linear" });
    // 3) yeni kartın üstüne zıpla ve otur
    setMood("jump");
    await Promise.all([
      animate(mx, target, { duration: 0.34, ease: "easeOut" }),
      animate(my, [6, -40, 0], { duration: 0.42, times: [0, 0.45, 1], ease: ["easeOut", "easeIn"] }),
    ]);
    setFacing(FACE_FRONT);
    setMoving(false);
  };

  const next = async () => {
    if (step === "login") {
      setError(null);
      setBusy(true);
      try {
        if (!hasAccount && name.trim()) await addOffline(name.trim());
        const accErr = useAccounts.getState().error;
        if (accErr) throw new Error(accErr);
        if (pw) await api.setLauncherPassword(pw);
      } catch (e) {
        setError(String(e).replace(/^Error: /, ""));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    void go(i + 1);
  };

  const finish = () => void finishSetup({ tour: tour && !(importAfter && launchers.length > 0), importAfter: importAfter && launchers.length > 0 });

  const canNext = step !== "login" || hasAccount || name.trim().length >= 3;
  const seatTop = 64; // kartların ortak üst çizgisi (sahne içinde)

  return (
    <motion.div className="setup-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="setup-stage" ref={stageRef}>
        <div className="setup-progress" aria-label={tx("Adım {0} / {1}", i + 1, STEPS.length)}>
          {STEPS.map((s, k) => <span key={s} className={clsx(k === i && "on", k < i && "done")} />)}
        </div>

        {/* Ashi: kartın üst kenarında oturur, adımlar arasında koşar */}
        <motion.div
          className="setup-mascot"
          style={{ x: mx, y: my, top: seatTop - AVATAR_H * SEAT_RATIO, width: AVATAR_W, height: AVATAR_H, marginLeft: -AVATAR_W / 2 }}
          aria-hidden
        >
          <AshiAvatar mood={mood} facing={facing} width={AVATAR_W} height={AVATAR_H} />
        </motion.div>

        <AnimatePresence mode="popLayout" custom={dir}>
          <motion.section
            key={step}
            className="setup-card"
            style={{ top: seatTop, marginLeft: -CARD_W / 2, width: CARD_W }}
            initial={{ opacity: 0, x: cardOffset(i, stageW) + dir * 40, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, x: cardOffset(i, stageW), y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.22 } }}
            transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
          >
            {step === "welcome" && (
              <div className="setup-body">
                <Logo size={34} />
                <h2>{tx("West Client'a hoş geldin")}</h2>
                <p>{tx("Ben Ashi. Seni birkaç adımda hazır edeyim: hesabını bağlayalım, eski paketlerini taşıyalım, sonra oyuna.")}</p>
              </div>
            )}

            {step === "login" && (
              <div className="setup-body">
                <h2>{tx("Giriş yap")}</h2>
                <p className="muted small">{tx("Minecraft hesabını bağla. İstersen launcher'ı bir şifreyle kilitleyebilirsin.")}</p>

                {hasAccount ? (
                  <div className="setup-account"><Check size={15} /> {accounts.map((a) => a.username).join(", ")} {tx("bağlandı")}</div>
                ) : (
                  <>
                    <button className="btn btn-primary" disabled={loginOpen} onClick={() => void startLogin()}>
                      {loginOpen ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
                      {loginOpen ? tx("Microsoft penceresinde giriş yap…") : tx("Microsoft ile giriş yap")}
                    </button>
                    <div className="setup-or"><span>veya offline oyna</span></div>
                    <label className="field">
                      <span>{tx("Kullanıcı adı")}</span>
                      <div className="pw-field">
                        <input id="setup-name" value={name} placeholder={offlineDefault || tx("Steve")} maxLength={16} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} />
                        <span className="pw-eye static"><UserRound size={16} /></span>
                      </div>
                    </label>
                  </>
                )}

                <label className="field" htmlFor="setup-pw">
                  <span>{tx("Launcher şifresi")} <span className="muted">{tx("(isteğe bağlı)")}</span></span>
                  <PasswordField id="setup-pw" value={pw} onChange={setPw} visible={pwVisible} onToggle={() => setPwVisible((v) => !v)} placeholder={tx("Boş bırakırsan kilit olmaz")} onEnter={() => canNext && void next()} />
                </label>
                <p className="muted tiny"><ShieldCheck size={12} /> {tx("Bu şifre yalnızca bu bilgisayarda, geri çözülemeyen bir özet olarak saklanır. Microsoft şifren buraya değil, Microsoft'un kendi penceresine girilir.")}</p>
                {error && <p className="hint error">{error}</p>}
              </div>
            )}

            {step === "import" && (
              <div className="setup-body">
                <h2>{tx("Eski paketlerin")}</h2>
                {scanning && !found ? (
                  <p className="muted small"><Loader2 size={13} className="spin" /> {tx("Bilgisayarındaki launcher'lara bakıyorum…")}</p>
                ) : launchers.length ? (
                  <>
                    <p>{tx("Bilgisayarında")} <strong>{launchers.join(", ")}</strong> buldum ({found!.length} {tx("instance). Modlarını, ayarlarını ve paketlerini West Client'a taşıyabilirim; orijinallerine dokunmam.")}</p>
                    <label className="check"><input type="checkbox" checked={importAfter} onChange={(e) => setImportAfter(e.target.checked)} /> <Import size={14} /> {tx("Kurulum bitince aktarım sihirbazını aç")}</label>
                  </>
                ) : (
                  <p className="muted">{tx("Başka bir launcher bulamadım. İstersen sonra Kütüphane'deki \"Aktar\" düğmesiyle bir klasör seçebilirsin.")}</p>
                )}
              </div>
            )}

            {step === "done" && (
              <div className="setup-body">
                <h2>{tx("Hazırsın!")}</h2>
                <p>{tx("Mod aramak, skin değiştirmek ya da çöken bir paketin suçlusunu bulmak için sol menüdeki simgeleri kullan. Takılırsan bana sor.")}</p>
                {!(importAfter && launchers.length) && (
                  <label className="check"><input type="checkbox" checked={tour} onChange={(e) => setTour(e.target.checked)} /> <Sparkles size={14} /> {tx("Ashi bana launcher'ı kısaca gezdirsin")}</label>
                )}
              </div>
            )}

            <footer className="setup-foot">
              {i > 0 ? (
                <button className="btn btn-ghost" disabled={moving || busy} onClick={() => void go(i - 1)}><ArrowLeft size={15} /> {tx("Geri")}</button>
              ) : <span />}
              {step === "login" && !hasAccount && <button className="btn-link" disabled={moving} onClick={() => void go(i + 1)}>{tx("Şimdilik atla")}</button>}
              {step === "done" ? (
                <button className="btn btn-primary" onClick={finish}><Check size={15} /> {tx("Başla")}</button>
              ) : (
                <button className="btn btn-primary" disabled={moving || busy || !canNext} onClick={() => void next()}>
                  {busy ? <Loader2 size={15} className="spin" /> : null} {tx("İleri")} <ArrowRight size={15} />
                </button>
              )}
            </footer>
          </motion.section>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** Launcher şifreyle kilitliyse açılışta gösterilir. Aynı oturan Ashi, aynı tepkiler. */
export function LockScreen() {
  const { locked, setLocked, splashDone } = useOnboarding();
  const [pw, setPw] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [shake, setShake] = useState(0);

  useEffect(() => {
    if (!isTauri()) return setLocked(false);
    api.lockStatus().then((s) => setLocked(s.hasPassword)).catch(() => setLocked(false));
  }, [setLocked]);

  if (!locked || !splashDone) return null;

  const unlock = async () => {
    if (!pw || checking) return;
    setChecking(true);
    const ok = await api.verifyLauncherPassword(pw).catch(() => false);
    setChecking(false);
    if (ok) {
      setLocked(false);
    } else {
      setError(true);
      setShake((n) => n + 1);
      setVisible(false);
    }
  };

  const mood: AshiMood = error && !visible ? "sit-cover" : visible ? "sit-peek" : "sit-cover";

  return (
    <motion.div className="setup-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="setup-stage">
        <div className="setup-mascot" style={{ top: 120 - AVATAR_H * SEAT_RATIO, width: AVATAR_W, height: AVATAR_H, marginLeft: -AVATAR_W / 2 }} aria-hidden>
          <AshiAvatar mood={mood} width={AVATAR_W} height={AVATAR_H} />
        </div>
        <motion.section
          key={shake}
          className="setup-card"
          style={{ top: 120, marginLeft: -CARD_W / 2, width: CARD_W }}
          animate={shake ? { x: [0, -10, 9, -6, 4, 0] } : { x: 0 }}
          transition={{ duration: 0.4 }}
        >
          {!forgot ? (
            <div className="setup-body">
              <h2>{tx("Tekrar hoş geldin")}</h2>
              <label className="field" htmlFor="lock-pw">
                <span>{tx("Launcher şifresi")}</span>
                <PasswordField id="lock-pw" value={pw} onChange={(v) => { setPw(v); setError(false); }} visible={visible} onToggle={() => setVisible((v) => !v)} autoFocus onEnter={() => void unlock()} />
              </label>
              {error && <p className="hint error">{tx("Şifre yanlış. Tekrar dene.")}</p>}
              <footer className="setup-foot">
                <button className="btn-link" onClick={() => setForgot(true)}>{tx("Şifremi unuttum")}</button>
                <button className="btn btn-primary" disabled={!pw || checking} onClick={() => void unlock()}>
                  {checking ? <Loader2 size={15} className="spin" /> : null} {tx("Kilidi aç")}
                </button>
              </footer>
            </div>
          ) : (
            <div className="setup-body">
              <h2>{tx("Şifreyi sıfırla")}</h2>
              <p className="small">{tx("Güvenliğin için şifre sıfırlanırken bu launcher'daki")} <strong>{tx("kayıtlı hesaplar da kaldırılır")}</strong>{tx(". Instance'ların, modların ve dünyaların olduğu gibi kalır; hesabını sonra yeniden bağlayabilirsin.")}</p>
              <footer className="setup-foot">
                <button className="btn btn-ghost" onClick={() => setForgot(false)}>{tx("Vazgeç")}</button>
                <button className="btn btn-danger" onClick={async () => { await api.resetLauncherLock(); await useAccounts.getState().load(); setLocked(false); }}>{tx("Sıfırla ve aç")}</button>
              </footer>
            </div>
          )}
        </motion.section>
      </div>
    </motion.div>
  );
}
