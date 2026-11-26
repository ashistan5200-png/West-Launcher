import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Brain, RotateCcw, Sparkles, X } from "lucide-react";
import { useChat } from "@/stores/chat";
import { useInstances } from "@/stores/instances";
import { useContent } from "@/stores/content";
import { aiReady, useAi } from "@/stores/ai";
import { AiSetupBadge } from "./AiSetup";
import { AshiHead } from "./AshiHead";
import { ContentRow } from "./ContentRow";
import { LOADER_LABEL } from "@/lib/format";
import { tx } from "@/lib/i18n";

const SUGGESTIONS = [
  tx("Bana iyi bir korku-aksiyon modpacki öner"),
  tx("PvP için FPS'i artıracak modlar öner"),
  tx("Düşük sistemde güzel duran bir shader"),
  tx("Vanilla hissini bozmayan keşif modları"),
];

/** Sağdan açılan Ashi sohbet paneli. */
export function AshiChat() {
  const { open, setOpen, busy, messages, send, reset, mode, activeInstance, setActiveInstance } = useChat();
  const ai = useAi();
  const navigate = useNavigate();
  const allInstances = useInstances((s) => s.instances);
  const instances = useMemo(() => allInstances.filter((i) => !i.isTemplate), [allInstances]);
  const loadInstalled = useContent((s) => s.loadInstalled);
  const [draft, setDraft] = useState("");
  const preset = useChat((s) => s.draft);
  useEffect(() => {
    if (preset) {
      setDraft(preset);
      useChat.getState().setDraft(null);
    }
  }, [preset]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    void ai.refresh();
    if (!activeInstance && instances[0]) setActiveInstance(instances[0].id);
    window.setTimeout(() => inputRef.current?.focus(), 180);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeInstance) void loadInstalled(activeInstance);
  }, [activeInstance, loadInstalled]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const submit = (text = draft) => {
    if (!text.trim() || busy) return;
    setDraft("");
    void send(text);
  };

  // Son yanıt hangi modda geldiyse o; henüz yanıt yoksa kurulum durumuna bak
  const smart = mode ? mode === "ollama" : aiReady(ai.status);
  const modeLabel = smart ? tx("Akıllı mod · bilgisayarında çalışır") : tx("Basit mod · anahtar kelimeler");

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="chat-panel"
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          aria-label={tx("Ashi sohbet")}
        >
          <header className="chat-head">
            <AshiHead size={30} />
            <div className="grow">
              <strong>{tx("Ashi")}</strong>
              <span className="muted tiny chat-mode">
                <Sparkles size={11} /> {modeLabel}
              </span>
            </div>
            <button className="icon-btn" title={tx("Yeni sohbet")} onClick={reset} disabled={busy || messages.length === 0}>
              <RotateCcw size={15} />
            </button>
            <button className="icon-btn" title={tx("Kapat")} onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </header>

          <AiSetupBadge />
          {!smart && !ai.progress && (
            <button className="chat-upgrade" onClick={() => ai.ask(true)}>
              <Brain size={15} />
              <span className="grow"><strong>{tx("Ashi'yi akıllandır")}</strong><span className="muted tiny">{tx("Ücretsiz · tek tıkla kurulur")}</span></span>
              <Sparkles size={14} className="accent" />
            </button>
          )}

          <div className="chat-target">
            <span className="muted tiny">{tx("Hedef")}</span>
            <select className="select-sm grow" value={activeInstance ?? ""} onChange={(e) => setActiveInstance(e.target.value || null)}>
              <option value="">{tx("Instance seçilmedi")}</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>{i.name} · {LOADER_LABEL[i.loader.kind]} {i.mcVersion}</option>
              ))}
            </select>
          </div>

          <div className="chat-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                <AshiHead size={56} />
                <p>{tx("Selam, ben Ashi! Ne tür bir oyun istediğini anlat; Modrinth'i tarayıp en uygun modları, modpack'leri ve shader'ları bulayım.")}</p>
                {!smart && <p className="muted tiny">{tx("Şu an basit moddayım: mesajındaki önemli kelimeleri yakalayıp arıyorum.")}</p>}
                <div className="chat-suggest">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="suggest" onClick={() => submit(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <motion.div
                key={m.id}
                className={`chat-msg ${m.role}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {m.role === "ashi" && <AshiHead size={22} className="chat-avatar" />}
                <div className="chat-body">
                  <p className={`chat-bubble ${m.error ? "error" : ""}`}>{m.text}</p>
                  {m.keywords && m.keywords.length > 0 && (
                    <div className="chat-keywords" title={tx("Basit modda Ashi bu kelimelerle aradı")}>
                      <span className="muted tiny">{tx("Yakaladığım kelimeler")}</span>
                      {m.keywords.map((k) => <mark key={k}>{k}</mark>)}
                    </div>
                  )}
                  {m.picks && m.picks.length > 0 && (
                    <div className="chat-picks">
                      {m.picks.map((p) => (
                        <ContentRow key={`${p.hit.source}:${p.hit.id}`} hit={p.hit} reason={p.reason} instanceId={activeInstance} compact
                          onOpen={p.hit.source === "modrinth" ? () => navigate(`/browse?project=${encodeURIComponent(p.hit.slug || p.hit.id)}`) : undefined} />
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {busy && (
              <div className="chat-msg ashi">
                <AshiHead size={22} className="chat-avatar" />
                <div className="chat-bubble typing" aria-label={tx("Ashi düşünüyor")}><span /><span /><span /></div>
              </div>
            )}
          </div>

          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <textarea
              ref={inputRef}
              rows={1}
              placeholder={tx("Ashi'ye bir şey sor…")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button className="btn btn-primary chat-send" disabled={!draft.trim() || busy} aria-label={tx("Gönder")}>
              <ArrowUp size={16} />
            </button>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
