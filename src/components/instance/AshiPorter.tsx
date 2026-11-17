import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, CircleHelp, Loader2, PackageX, Power, Sparkles, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/ipc";
import { LOADER_LABEL } from "@/lib/format";
import { useInstances } from "@/stores/instances";
import type { Instance, LoaderKind, ManifestEntry, PortItem, PortResult } from "@/lib/types";
import { AshiHead } from "@/components/AshiHead";
import { ContentIcon } from "@/components/ContentIcon";
import { tx } from "@/lib/i18n";

type Step = "target" | "checking" | "review" | "porting" | "done";
type Choice = "remove" | "keep";

/**
 * Ashi Taşıyıcı: instance'ı başka bir Minecraft sürümüne taşır. Eski instance'a dokunmaz;
 * yeni sürümde bir kopya oluşturur, uyumlu mod sürümlerini kurar, uyumsuzlar için sorar.
 */
export function AshiPorter({ instance, open, onClose }: { instance: Instance; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const refresh = useInstances((s) => s.refresh);
  const [step, setStep] = useState<Step>("target");
  const [mcList, setMcList] = useState<ManifestEntry[]>([]);
  const [mc, setMc] = useState("");
  const [loader, setLoader] = useState<LoaderKind>(instance.loader.kind);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [worlds, setWorlds] = useState(true);
  const [plan, setPlan] = useState<PortItem[]>([]);
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [result, setResult] = useState<PortResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("target"); setError(null); setResult(null); setPlan([]); setChoice({}); setNameTouched(false);
    setLoader(instance.loader.kind); setWorlds(true);
    api.listMcVersions(false).then((l) => {
      const rel = l.filter((v) => v.type === "release");
      setMcList(rel);
      setMc((cur) => cur || rel.find((v) => v.id !== instance.mcVersion)?.id || "");
    }).catch(() => setMcList([]));
  }, [open, instance]);
  useEffect(() => { if (!nameTouched) setName(`${instance.name} (${mc})`); }, [mc, instance.name, nameTouched]);

  const problems = useMemo(() => plan.filter((p) => p.status === "missing" || p.status === "unknown"), [plan]);
  const good = plan.length - problems.length;
  const undecided = problems.filter((p) => !choice[p.id]).length;

  const check = async () => {
    setStep("checking"); setError(null);
    try {
      const p = await api.portPlan(instance.id, mc, loader);
      setPlan(p);
      setStep("review");
    } catch (e) { setError(String(e).replace(/^Error: /, "")); setStep("target"); }
  };

  const run = async () => {
    setStep("porting"); setError(null);
    try {
      const keep = problems.filter((p) => choice[p.id] === "keep").map((p) => p.id);
      const r = await api.portInstance(instance.id, mc, loader, null, name.trim(), worlds, keep);
      setResult(r);
      await refresh();
      setStep("done");
    } catch (e) { setError(String(e).replace(/^Error: /, "")); setStep("review"); }
  };

  const bubble =
    step === "target" ? tx("{0} paketini hangi sürüme taşıyalım? Eski instance'a dokunmam, yeni sürümde bir kopyasını oluştururum.", instance.name)
    : step === "checking" ? tx("Modrinth'te her mod için Minecraft {0} sürümünü arıyorum…", mc)
    : step === "review" ? (problems.length ? tx("{0} içerik {1}'e hazır. {2} tanesinin {3} sürümünü bulamadım; bunları silelim mi?", good, mc, problems.length, mc) : tx("Harika! {0} içeriğin hepsi {1}'e hazır.", plan.length, mc))
    : step === "porting" ? tx("Taşıyorum… Yeni sürümleri indiriyor ve eksik bağımlılıkları kuruyorum.")
    : tx("Bitti! \"{0}\" hazır.", result?.instance.name);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => step !== "porting" && onClose()}>
          <motion.div className="porter" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={tx("Ashi Taşıyıcı")}>
            <header className="porter-head">
              <motion.div animate={step === "checking" || step === "porting" ? { rotate: [0, -8, 8, 0] } : {}} transition={{ repeat: Infinity, duration: 1.6 }}>
                <AshiHead size={52} />
              </motion.div>
              <div className="grow">
                <span className="porter-title">{tx("Ashi Taşıyıcı")}</span>
                <p className="porter-bubble">{bubble}</p>
              </div>
              {step !== "porting" && <button className="icon-btn" onClick={onClose} aria-label={tx("Kapat")}><X size={17} /></button>}
            </header>

            {error && <div className="banner banner-error">{error}</div>}

            {step === "target" && (
              <div className="porter-body">
                <div className="porter-route">
                  <div className="porter-ver from"><span className="muted tiny">{tx("Şu an")}</span><strong>{LOADER_LABEL[instance.loader.kind]} {instance.mcVersion}</strong></div>
                  <ArrowRight size={20} className="muted" />
                  <div className="porter-ver to">
                    <span className="muted tiny">{tx("Hedef")}</span>
                    <select value={mc} onChange={(e) => setMc(e.target.value)}>
                      {mcList.map((v) => <option key={v.id} value={v.id} disabled={v.id === instance.mcVersion && loader === instance.loader.kind}>{v.id}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <span>{tx("Yükleyici")}</span>
                  <div className="segmented wrap">
                    {(["fabric", "quilt", "forge", "neoforge", "vanilla"] as LoaderKind[]).map((k) => (
                      <button key={k} className={clsx(loader === k && "active")} onClick={() => setLoader(k)}>{LOADER_LABEL[k]}</button>
                    ))}
                  </div>
                  {loader !== instance.loader.kind && <span className="hint">{tx("Yükleyici değişince çoğu mod uyumsuz olur; Ashi her biri için karşılık arar.")}</span>}
                </div>
                <label className="field"><span>{tx("Yeni instance'ın adı")}</span><input value={name} maxLength={48} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} /></label>
                <label className="check"><input type="checkbox" checked={worlds} onChange={(e) => setWorlds(e.target.checked)} /> {tx("Dünyaları da kopyala")}</label>
                <p className="muted tiny">{tx("Ayarlar (config, options.txt), resource pack'ler ve shader'lar da taşınır. Eski instance olduğu gibi kalır.")}</p>
                <div className="porter-actions">
                  <button className="btn btn-ghost" onClick={onClose}>{tx("Vazgeç")}</button>
                  <button className="btn btn-primary" disabled={!mc || (mc === instance.mcVersion && loader === instance.loader.kind)} onClick={() => void check()}><Sparkles size={15} /> {tx("Ashi kontrol etsin")}</button>
                </div>
              </div>
            )}

            {step === "checking" && <div className="porter-wait"><Loader2 className="spin" size={22} /></div>}

            {(step === "review" || step === "porting") && (
              <div className="porter-body">
                <div className="porter-stats">
                  <span className="ok"><Check size={14} /> {good} {tx("hazır")}</span>
                  {problems.length > 0 && <span className="bad"><PackageX size={14} /> {problems.length} uyumsuz</span>}
                  <span className="muted tiny grow">{LOADER_LABEL[instance.loader.kind]} {instance.mcVersion} → {LOADER_LABEL[loader]} {mc}</span>
                  {problems.length > 1 && step === "review" && (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => setChoice(Object.fromEntries(problems.map((p) => [p.id, "remove"])))}><Trash2 size={13} /> {tx("Hepsini sil")}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setChoice(Object.fromEntries(problems.map((p) => [p.id, "keep"])))}><Power size={13} /> {tx("Hepsini kapalı tut")}</button>
                    </>
                  )}
                </div>
                <div className="porter-list">
                  {plan.map((p) => {
                    const bad = p.status === "missing" || p.status === "unknown";
                    const c = choice[p.id];
                    return (
                      <div key={p.id} className={clsx("porter-row", bad ? "bad" : "ok", c && `chose-${c}`)}>
                        <ContentIcon src={p.icon} title={p.title} kind={p.kind} size={34} />
                        <div className="porter-main">
                          <strong className="truncate">{p.title}</strong>
                          <span className="muted tiny truncate">
                            {p.status === "ok" ? <>{p.fromVersion ?? "?"} <ArrowRight size={11} /> <b className="okc">{p.toVersion}</b></>
                              : p.status === "same" ? <>{tx("Bu sürüm")} {mc} {tx("ile zaten uyumlu, olduğu gibi kalır")}</>
                              : p.status === "unknown" ? <><CircleHelp size={11} /> {tx("Modrinth'te tanınmadı (elle eklenmiş dosya)")}</>
                              : <>{mc} {tx("için uyumlu sürüm yok")}</>}
                          </span>
                        </div>
                        {bad ? (
                          step === "review" ? (
                            <div className="porter-ask">
                              <span className="muted tiny">{tx("Silelim mi?")}</span>
                              <button className={clsx("pchip", c === "remove" && "on danger")} onClick={() => setChoice({ ...choice, [p.id]: "remove" })}><Trash2 size={12} /> {tx("Sil")}</button>
                              <button className={clsx("pchip", c === "keep" && "on")} onClick={() => setChoice({ ...choice, [p.id]: "keep" })}><Power size={12} /> {tx("Kapalı tut")}</button>
                            </div>
                          ) : <span className="muted tiny">{c === "keep" ? tx("Kapalı tutulacak") : tx("Silinecek")}</span>
                        ) : <Check size={16} className="okc" />}
                      </div>
                    );
                  })}
                  {plan.length === 0 && <p className="muted small pad">{tx("Bu instance'ta taşınacak içerik yok; yalnızca sürüm değişecek.")}</p>}
                </div>
                <div className="porter-actions">
                  {step === "review" ? (
                    <>
                      <button className="btn btn-ghost" onClick={() => setStep("target")}>{tx("Geri")}</button>
                      <span className="muted tiny grow">{undecided > 0 ? tx("{0} içerik için karar ver", undecided) : ""}</span>
                      <button className="btn btn-primary" disabled={undecided > 0} onClick={() => void run()}><ArrowRight size={15} /> {mc} {tx("sürümüne taşı")}</button>
                    </>
                  ) : <span className="muted small row" style={{ gap: 8 }}><Loader2 size={15} className="spin" /> {tx("Taşınıyor… İlerleme sağ altta görünür.")}</span>}
                </div>
              </div>
            )}

            {step === "done" && result && (
              <div className="porter-body">
                <div className="porter-summary">
                  <div><strong>{result.report.ported.length}</strong><span>{tx("taşındı")}</span></div>
                  <div><strong>{result.report.dependencies.length}</strong><span>{tx("bağımlılık eklendi")}</span></div>
                  <div><strong>{result.report.removed.length}</strong><span>silindi</span></div>
                  <div><strong>{result.report.keptDisabled.length}</strong><span>{tx("kapalı tutuldu")}</span></div>
                </div>
                {result.report.failed.length > 0 && (
                  <div className="banner banner-error"><strong>{tx("Taşınamayanlar:")}</strong> {result.report.failed.join("; ")}</div>
                )}
                <p className="muted small">{tx("İlk açılışta Minecraft")} {mc} {tx("ve yükleyicisi indirilir. Bazı modların ayarları yeni sürümde sıfırlanmış olabilir.")}</p>
                <div className="porter-actions">
                  <button className="btn btn-ghost" onClick={onClose}>{tx("Kapat")}</button>
                  <button className="btn btn-primary" onClick={() => { onClose(); navigate(`/instance/${result.instance.id}`); }}>{tx("Yeni instance'a git")} <ArrowRight size={15} /></button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
