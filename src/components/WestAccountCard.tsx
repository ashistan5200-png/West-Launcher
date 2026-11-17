import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AtSign, Check, CircleAlert, Loader2, LogIn, LogOut, Mail, MailCheck, ShieldCheck, UserPlus, UserRound, X } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/ipc";
import { useWest } from "@/stores/west";
import { PasswordField } from "./SetupWizard";
import { Logo } from "./Logo";
import { tx } from "@/lib/i18n";

const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const errText = (e: unknown) => String(e).replace(/^Error: /, "");

/** 0–4 arası şifre gücü */
function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-zçğıöşü]/.test(pw) && /[A-ZÇĞİÖŞÜ]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const STRENGTH = [tx("Çok zayıf"), tx("Zayıf"), tx("Orta"), tx("İyi"), tx("Güçlü")];

/** West hesabı: kayıt ol / giriş yap / oturum. */
export function WestAccountCard() {
  const { configured, account, loaded, load, setAccount, logout } = useWest();
  const [tab, setTab] = useState<"login" | "signup">("signup");
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  return (
    <section className="west-card">
      <div className="west-card-head">
        <span className="west-badge"><Logo size={18} /></span>
        <div className="grow">
          <h3>{tx("West hesabı")}</h3>
          <p className="muted tiny">{tx("Tek hesapla West Client'ı her bilgisayarda kullan.")}</p>
        </div>
      </div>

      {!loaded ? (
        <p className="muted small"><Loader2 size={14} className="spin" /> {tx("Yükleniyor…")}</p>
      ) : !configured ? (
        <div className="banner banner-info"><CircleAlert size={14} /> {tx("West hesap sunucusu henüz bağlanmadı. Bir sonraki güncellemeyle açılacak.")}</div>
      ) : account ? (
        <div className="west-me">
          <span className="west-avatar">{account.username.slice(0, 1).toUpperCase()}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <strong className="truncate">{account.username}</strong>
            <span className="muted small truncate">{account.email}</span>
            {account.emailConfirmed ? (
              <span className="west-ok"><MailCheck size={13} /> {tx("E-posta doğrulandı")}</span>
            ) : (
              <span className="west-warn"><Mail size={13} /> {tx("E-posta doğrulanmadı")}</span>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void logout()}><LogOut size={14} /> {tx("Çıkış")}</button>
        </div>
      ) : (
        <>
          <div className="segmented">
            <button className={clsx(tab === "signup" && "active")} onClick={() => setTab("signup")}><UserPlus size={14} /> {tx("Kayıt ol")}</button>
            <button className={clsx(tab === "login" && "active")} onClick={() => setTab("login")}><LogIn size={14} /> {tx("Giriş yap")}</button>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
              {tab === "signup" ? <SignupForm onDone={setAccount} toLogin={() => setTab("login")} /> : <LoginForm onDone={setAccount} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </section>
  );
}

function SignupForm({ onDone, toLogin }: { onDone: (a: import("@/lib/types").WestAccount) => void; toLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [avail, setAvail] = useState<"idle" | "checking" | "ok" | "taken">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Kullanıcı adı boşta mı? (yazmayı bırakınca)
  useEffect(() => {
    if (!USERNAME.test(username)) return setAvail("idle");
    setAvail("checking");
    const t = window.setTimeout(() => {
      api.westUsernameAvailable(username).then((ok) => setAvail(ok ? "ok" : "taken")).catch(() => setAvail("idle"));
    }, 450);
    return () => window.clearTimeout(t);
  }, [username]);

  const st = strength(pw);
  const problems = useMemo(() => {
    const p: string[] = [];
    if (username && !USERNAME.test(username)) p.push(tx("Kullanıcı adı 3–16 karakter; harf, rakam, alt çizgi."));
    if (email && !EMAIL.test(email)) p.push(tx("E-posta adresi geçerli görünmüyor."));
    if (pw && pw.length < 8) p.push(tx("Şifre en az 8 karakter olmalı."));
    else if (pw && !(/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(pw) && /\d/.test(pw))) p.push(tx("Şifrede en az bir harf ve bir rakam olsun."));
    if (pw2 && pw !== pw2) p.push(tx("Şifreler aynı değil."));
    return p;
  }, [username, email, pw, pw2]);
  const ready = USERNAME.test(username) && EMAIL.test(email) && pw.length >= 8 && pw === pw2 && problems.length === 0 && avail !== "taken";

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.westSignup(username, email, pw);
      if (r.account) onDone(r.account);
      else setSent(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="west-sent">
        <MailCheck size={28} />
        <strong>{tx("Neredeyse bitti!")}</strong>
        <p className="small muted"><b>{email}</b> {tx("adresine bir doğrulama bağlantısı gönderdik. Bağlantıya tıkla, sonra buradan giriş yap.")}</p>
        <button className="btn btn-primary btn-sm" onClick={toLogin}><LogIn size={14} /> {tx("Giriş yap")}</button>
      </div>
    );
  }

  return (
    <form className="west-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="field">
        <span>{tx("Kullanıcı adı")}</span>
        <div className="pw-field">
          <input value={username} maxLength={16} placeholder={tx("AshiWest")} autoComplete="username" onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))} />
          <span className="pw-eye static">
            {avail === "checking" ? <Loader2 size={15} className="spin" /> : avail === "ok" ? <Check size={15} className="ok" /> : avail === "taken" ? <X size={15} className="bad" /> : <UserRound size={15} />}
          </span>
        </div>
        {avail === "taken" && <small className="hint error">{tx("Bu kullanıcı adı alınmış.")}</small>}
      </label>
      <label className="field">
        <span>{tx("E-posta")}</span>
        <div className="pw-field">
          <input type="email" value={email} placeholder="sen@ornek.com" autoComplete="email" onChange={(e) => setEmail(e.target.value.trim())} />
          <span className="pw-eye static"><AtSign size={15} /></span>
        </div>
      </label>
      <label className="field" htmlFor="west-pw">
        <span>{tx("Şifre")}</span>
        <PasswordField id="west-pw" value={pw} onChange={setPw} visible={show} onToggle={() => setShow((v) => !v)} placeholder={tx("En az 8 karakter")} />
        {pw && (
          <div className="pw-meter" data-level={st}>
            {[0, 1, 2, 3].map((i) => <span key={i} className={clsx(i < Math.max(1, st) && "on")} />)}
            <small>{STRENGTH[st]}</small>
          </div>
        )}
      </label>
      <label className="field" htmlFor="west-pw2">
        <span>{tx("Şifre (tekrar)")}</span>
        <PasswordField id="west-pw2" value={pw2} onChange={setPw2} visible={show} onToggle={() => setShow((v) => !v)} onEnter={() => void submit()} />
      </label>
      {problems.length > 0 && <ul className="west-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {error && <p className="hint error">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={!ready || busy}>
        {busy ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />} {tx("West hesabı oluştur")}
      </button>
      <p className="muted tiny"><ShieldCheck size={12} /> {tx("Şifren yalnızca West hesap sunucusunda, geri çözülemeyen biçimde saklanır; West Client onu bilgisayarına yazmaz.")}</p>
    </form>
  );
}

function LoginForm({ onDone }: { onDone: (a: import("@/lib/types").WestAccount) => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !EMAIL.test(email) || !pw) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.westLogin(email, pw));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const forgot = async () => {
    setError(null);
    if (!EMAIL.test(email)) return setError(tx("Önce e-posta adresini yaz."));
    try {
      await api.westResetPassword(email);
      setNotice(tx("{0} adresine şifre sıfırlama bağlantısı gönderdik.", email));
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <form className="west-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="field">
        <span>{tx("E-posta")}</span>
        <div className="pw-field">
          <input type="email" value={email} placeholder="sen@ornek.com" autoComplete="email" onChange={(e) => setEmail(e.target.value.trim())} />
          <span className="pw-eye static"><AtSign size={15} /></span>
        </div>
      </label>
      <label className="field" htmlFor="west-login-pw">
        <span>{tx("Şifre")}</span>
        <PasswordField id="west-login-pw" value={pw} onChange={setPw} visible={show} onToggle={() => setShow((v) => !v)} onEnter={() => void submit()} />
      </label>
      {error && <p className="hint error">{error}</p>}
      {notice && <p className="hint">{notice}</p>}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" className="btn-link" style={{ marginLeft: 0 }} onClick={() => void forgot()}>{tx("Şifremi unuttum")}</button>
        <button className="btn btn-primary" type="submit" disabled={busy || !EMAIL.test(email) || !pw}>
          {busy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />} {tx("Giriş yap")}
        </button>
      </div>
    </form>
  );
}
