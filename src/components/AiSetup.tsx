import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, Check, Download, HardDrive, Loader2, Lock, RotateCcw, Rocket, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import { aiReady, MODELS, useAi } from "@/stores/ai";
import { useChat } from "@/stores/chat";
import { AshiHead } from "./AshiHead";

const STEPS = [
  { stage: "download", label: "Ollama indiriliyor" },
  { stage: "install", label: "Ollama kuruluyor" },
  { stage: "start", label: "Ollama başlatılıyor" },
  { stage: "model", label: "Ashi'nin beyni indiriliyor" },
] as const;

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(n > 10 * 1024 ** 3 ? 0 : 1)} GB`;

/** Ashi'nin kendi ağzından, tek tıkla Ollama + model kurulumu. */
export function AiSetupModal() {
  const { asking, ask, status, progress, error, install } = useAi();
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => { if (asking) setModel(null); }, [asking]);

  const chosen = model ?? status?.recommended ?? "qwen2.5:7b";
  const m = MODELS.find((x) => x.id === chosen) ?? MODELS[1];
  const needOllama = status ? !status.installed : true;
  const total = m.gb + (needOllama ? 1.5 : 0);
  const done = progress?.stage === "done" || (!progress && aiReady(status) && status?.model === chosen);
  const close = () => ask(false);

  return (
    <AnimatePresence>
      {asking && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={close}>
          <motion.div className="ai-setup" initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Ashi'yi akıllandır">
            <button className="icon-btn ai-setup-x" onClick={close} aria-label="Kapat"><X size={16} /></button>

            <div className="ai-setup-hero">
              <motion.div animate={progress && !done ? { rotate: [0, -6, 6, 0] } : {}} transition={{ repeat: Infinity, duration: 2.4 }}>
                <AshiHead size={64} />
              </motion.div>
              <div className="ai-bubble">
                {done ? "Hazırım! Artık ne istediğini gerçekten anlıyorum." : progress ? "Beynimi kuruyorum… Bu pencereyi kapatabilirsin, arka planda devam ederim." : "Biraz daha akıllı olmamı ister misin?"}
              </div>
            </div>

            {done ? (
              <div className="ai-setup-body">
                <ul className="ai-perks">
                  <li><Sparkles size={16} /> "Arkadaşlarla oynamalık korku modları" gibi cümleleri anlarım.</li>
                  <li><Brain size={16} /> Seçtiğin instance'ın sürümüne uygun öneririm.</li>
                </ul>
                <button className="btn btn-primary" onClick={() => { close(); useChat.getState().setOpen(true); }}>Ashi ile konuş</button>
              </div>
            ) : progress ? (
              <div className="ai-setup-body">
                <ol className="ai-steps">
                  {STEPS.map((s, i) => {
                    const cur = STEPS.findIndex((x) => x.stage === progress.stage);
                    // Zaten kurulu olan adımlar atlanır; geride kalanlar "tamam" görünür
                    const state = i < cur ? "ok" : i === cur ? "run" : "wait";
                    return (
                      <li key={s.stage} className={state}>
                        <span className="ai-step-ico">{state === "ok" ? <Check size={13} /> : state === "run" ? <Loader2 size={13} className="spin" /> : i + 1}</span>
                        <span className="grow">{s.label}</span>
                        {state === "run" && progress.total > 0 && <span className="muted tiny">{gb(progress.completed)} / {gb(progress.total)}</span>}
                      </li>
                    );
                  })}
                </ol>
                <div className="ai-progress"><div style={{ width: `${progress.total ? Math.round((progress.completed / progress.total) * 100) : 4}%` }} /></div>
                <button className="btn btn-ghost" onClick={close}>Arka planda devam et</button>
              </div>
            ) : (
              <div className="ai-setup-body">
                <ul className="ai-perks">
                  <li><Lock size={16} /> <span><strong>Tamamen ücretsiz.</strong> Hesap, anahtar ya da şifre istemez.</span></li>
                  <li><HardDrive size={16} /> <span><strong>Senin bilgisayarında çalışır.</strong> Yazdıkların hiçbir yere gönderilmez.</span></li>
                  <li><Rocket size={16} /> <span><strong>Tek seferde kurulur.</strong> Ollama ve Ashi'nin beyni birlikte iner, sen bir şey yapmazsın.</span></li>
                </ul>

                <div className="ai-models">
                  {MODELS.map((x) => (
                    <button key={x.id} className={clsx("ai-model", chosen === x.id && "active")} onClick={() => setModel(x.id)}>
                      <span className="row" style={{ gap: 6 }}>
                        <strong>{x.name}</strong>
                        {status?.recommended === x.id && <span className="chip chip-accent">Sana önerilen</span>}
                      </span>
                      <span className="muted tiny">{x.note}</span>
                      <span className="tiny">≈{x.gb} GB</span>
                    </button>
                  ))}
                </div>

                {error && <p className="hint error">{error}</p>}
                <button className="btn btn-primary btn-lg" onClick={() => void install(chosen)}>
                  {error ? <><RotateCcw size={16} /> Tekrar dene</> : <><Download size={16} /> Evet, beni akıllandır · ≈{total.toFixed(1)} GB</>}
                </button>
                <button className="btn-link muted" onClick={close}>Şimdilik basit modda kalayım</button>
                <p className="muted tiny" style={{ textAlign: "center" }}>
                  Basit modda da çalışırım: mesajındaki anahtar kelimeleri yakalayıp en popüler sonuçları gösteririm.
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Ashi panelinde ve Ayarlar'da görünen küçük kurulum durumu. */
export function AiSetupBadge() {
  const { progress, ask } = useAi();
  if (!progress || progress.stage === "done") return null;
  const pct = progress.total ? Math.round((progress.completed / progress.total) * 100) : null;
  return (
    <button className="ai-badge" onClick={() => ask(true)}>
      <Loader2 size={13} className="spin" />
      <span className="grow truncate">{progress.label}</span>
      {pct !== null && <span className="tiny">%{pct}</span>}
    </button>
  );
}
