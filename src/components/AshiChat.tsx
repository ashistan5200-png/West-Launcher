import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, RotateCcw, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useChat } from "@/stores/chat";
import { useInstances } from "@/stores/instances";
import { useContent } from "@/stores/content";
import { useSettings } from "@/stores/settings";
import { AshiHead } from "./AshiHead";
import { ContentRow } from "./ContentRow";
import { LOADER_LABEL } from "@/lib/format";

const SUGGESTIONS = [
  "Bana iyi bir korku-aksiyon modpacki öner",
  "PvP için FPS'i artıracak modlar öner",
  "Düşük sistemde güzel duran bir shader",
  "Vanilla hissini bozmayan keşif modları",
];

/** Sağdan açılan Ashi sohbet paneli. */
export function AshiChat() {
  const navigate = useNavigate();
  const { open, setOpen, busy, messages, send, reset, mode, activeInstance, setActiveInstance, secrets, loadSecrets } = useChat();
  const allInstances = useInstances((s) => s.instances);
  const instances = useMemo(() => allInstances.filter((i) => !i.isTemplate), [allInstances]);
  const loadInstalled = useContent((s) => s.loadInstalled);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    void loadSecrets();
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

  const provider = useSettings((s) => s.settings.aiProvider);
  const modeLabel =
    mode === "keyword" || provider === "off" || (provider === "claude" && secrets && !secrets.anthropic)
      ? "Basit arama modu"
      : provider === "claude" ? "Claude Haiku · kendi anahtarınla" : "Yerel model · ücretsiz";
  const smart = modeLabel !== "Basit arama modu";

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="chat-panel"
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          aria-label="Ashi sohbet"
        >
          <header className="chat-head">
            <AshiHead size={30} />
            <div className="grow">
              <strong>Ashi</strong>
              <span className="muted tiny chat-mode">
                <Sparkles size={11} /> {modeLabel}
              </span>
            </div>
            <button className="icon-btn" title="Yeni sohbet" onClick={reset} disabled={busy || messages.length === 0}>
              <RotateCcw size={15} />
            </button>
            <button className="icon-btn" title="Kapat" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </header>

          <div className="chat-target">
            <span className="muted tiny">Hedef</span>
            <select className="select-sm grow" value={activeInstance ?? ""} onChange={(e) => setActiveInstance(e.target.value || null)}>
              <option value="">Instance seçilmedi</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>{i.name} · {LOADER_LABEL[i.loader.kind]} {i.mcVersion}</option>
              ))}
            </select>
          </div>

          <div className="chat-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                <AshiHead size={56} />
                <p>Selam, ben Ashi! Ne tür bir oyun istediğini anlat; Modrinth ve CurseForge'u tarayıp en uygun modları, modpack'leri ve shader'ları bulayım.</p>
                {!smart && (
                  <p className="muted tiny">
                    Şu an basit arama modundayım.{" "}
                    <button className="link" onClick={() => { setOpen(false); navigate("/settings#ai"); }}>Ücretsiz yerel yapay zekayı aç</button>{" "}
                    ve isteğini gerçekten anlayan moda geç.
                  </p>
                )}
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
                  {m.picks && m.picks.length > 0 && (
                    <div className="chat-picks">
                      {m.picks.map((p) => (
                        <ContentRow key={`${p.hit.source}:${p.hit.id}`} hit={p.hit} reason={p.reason} instanceId={activeInstance} compact />
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {busy && (
              <div className="chat-msg ashi">
                <AshiHead size={22} className="chat-avatar" />
                <div className="chat-bubble typing" aria-label="Ashi düşünüyor"><span /><span /><span /></div>
              </div>
            )}
          </div>

          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <textarea
              ref={inputRef}
              rows={1}
              placeholder="Ashi'ye bir şey sor…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button className="btn btn-primary chat-send" disabled={!draft.trim() || busy} aria-label="Gönder">
              <ArrowUp size={16} />
            </button>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
