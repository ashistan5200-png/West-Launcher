import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { AlertTriangle, ChevronDown, Cpu, Download, FileWarning, Package, Play, PowerOff, Search, Sparkles, Undo2, Wrench } from "lucide-react";
import { Modal } from "@/components/Modal";
import { AshiHead } from "@/components/AshiHead";
import { api } from "@/lib/ipc";
import { useSolver } from "@/stores/solver";
import type { CrashCause, FixReport } from "@/lib/types";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useAshi } from "@/stores/ashi";
import { tx } from "@/lib/i18n";
import { errorText } from "@/lib/format";

/** Her neden için başlık, açıklama ve öneri */
function causeText(c: CrashCause): { title: string; why: string; fix: string } {
  switch (c) {
    case "badResourcePath":
      return {
        title: tx("Geçersiz dosya adı"),
        why: tx("Bir mod, adında Minecraft'ın kabul etmediği bir karakter (Türkçe harf, büyük harf ya da boşluk) olan bir dosya kullanmaya çalışmış. Bu modun kendi hatası; senin bir şey yanlış yapmadın."),
        fix: tx("Modun yeni bir sürümü varsa güncelle; yoksa modu kapat ve geliştiricisine bildir."),
      };
    case "outOfMemory":
      return {
        title: tx("Bellek yetmedi"),
        why: tx("Oyuna ayrılan bellek (RAM) doldu. Çok modlu paketlerde ve yüksek görüş mesafesinde olur."),
        fix: tx("Instance ayarlarından belleği artır (çok modlu paketlerde 6–8 GB önerilir) ya da görüş mesafesini düşür."),
      };
    case "mixinFailed":
      return {
        title: tx("Mod bu sürümle ya da başka bir modla uyumsuz"),
        why: tx("Bir mod, oyunun kodunu değiştirmeye çalışırken başarısız oldu. Genelde mod bu Minecraft sürümü için değildir ya da başka bir modla çakışır."),
        fix: tx("Modu güncelle; düzelmezse kapat."),
      };
    case "missingClass":
      return {
        title: tx("Eksik bir parça var"),
        why: tx("Bir mod, yüklü olmayan başka bir modun ya da kütüphanenin kodunu arıyor."),
        fix: tx("Eksik bağımlılığı kur ya da modları güncelle. İçerik sekmesindeki \"Tümünü güncelle\" çoğu zaman çözer."),
      };
    case "missingDependency":
      return {
        title: tx("Eksik ya da uyumsuz bağımlılık"),
        why: tx("Mod yükleyici, bazı modların istediği başka modları bulamadı ya da sürümleri uymuyor."),
        fix: tx("Aşağıda istenenleri Keşfet'ten kur ya da uyumsuz modu kaldır."),
      };
    case "javaVersion":
      return {
        title: tx("Yanlış Java sürümü"),
        why: tx("Bir mod, kullanılan Java'dan daha yeni bir Java ile derlenmiş."),
        fix: tx("Instance ayarlarında Java yolunu boşalt; West Client doğru Java'yı kendisi indirir."),
      };
    case "graphics":
      return {
        title: tx("Ekran kartı / sürücü sorunu"),
        why: tx("Oyun, ekran kartıyla konuşurken hata aldı. Genelde eski bir sürücü ya da shader/grafik modu yüzünden olur."),
        fix: tx("Ekran kartı sürücünü güncelle; shader veya grafik modu kullanıyorsan onu kapatıp dene."),
      };
    case "duplicateMod":
      return {
        title: tx("Aynı mod iki kez yüklü"),
        why: tx("mods klasöründe aynı modun iki farklı dosyası var."),
        fix: tx("İçerik sekmesinde kopyalardan birini kaldır."),
      };
    default:
      return {
        title: tx("Beklenmeyen hata"),
        why: tx("Oyun beklenmedik bir hatayla kapandı."),
        fix: tx("Aşağıdaki suçlu modu güncellemeyi ya da kapatmayı dene."),
      };
  }
}

export function AshiSolver() {
  const { open, close } = useSolver();
  const navigate = useNavigate();
  const [details, setDetails] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState<FixReport | null>(null);

  if (!open) return <Modal open={false} title="" onClose={close}>{null}</Modal>;
  const { a, instanceId, name, modCount } = open;
  const c = a?.culprit ?? null;
  const t = causeText(a?.cause ?? "unknown");

  const disable = async () => {
    if (!c) return;
    setErr(null);
    try {
      await api.disableMods(instanceId, [c.file]);
      setDone(tx("{0} kapatıldı. Oyunu yeniden başlatabilirsin; istediğin zaman İçerik sekmesinden geri açarsın.", c.name));
    } catch (e) {
      setErr(errorText(e));
    }
  };
  // Ashi'nin onarabildiği hatalar: şimdilik geçersiz dosya adı
  const canFix = !!c && !c.ours && a?.cause === "badResourcePath";
  const fix = async () => {
    if (!c) return;
    setErr(null);
    setFixing(true);
    try {
      setFixed(await api.fixMod(instanceId, c.file, a?.detail ?? null));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setFixing(false);
    }
  };
  const undo = async () => {
    if (!fixed) return;
    try {
      await api.undoFix(instanceId, fixed.file, fixed.backup);
      setFixed(null);
      setDone(tx("Geri aldım; mod eski haline döndü."));
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const play = () => {
    reset();
    close();
    void useInstances.getState().launch(instanceId, useSettings.getState().offlineName);
  };
  const reset = () => { setDone(null); setErr(null); setDetails(false); setFixed(null); setFixing(false); };
  const goContent = () => {
    close();
    navigate(`/instance/${instanceId}`, { state: { tab: "content" } });
  };
  const goSettings = () => {
    close();
    navigate(`/instance/${instanceId}`, { state: { tab: "settings" } });
  };
  const hunt = () => {
    close();
    void useAshi.getState().openConfirm(instanceId, name);
  };

  const line = !a
    ? tx("Bu çökme için bir rapor bulamadım.")
    : c
      ? c.ours
        ? tx("İz West Companion'a çıkıyor; yani hata bizde. Kusura bakma!")
        : tx("Buldum! Çökme anında çalışan kod {0} moduna ait.", c.name)
      : tx("Suçlu modu kesin bulamadım ama nedeni belli.");

  return (
    <Modal open title={tx("Ashi Çözücü")} onClose={() => { reset(); close(); }} width={560}>
      <div className="solver-head">
        <AshiHead size={44} />
        <div className="grow">
          <span className="solver-eyebrow">{name}</span>
          <strong>{line}</strong>
        </div>
      </div>

      {a && (
        <div className="solver-card cause">
          <div className="solver-card-title"><FileWarning size={15} /> {t.title}</div>
          <p>{t.why}</p>
          {a.detail && <pre className="solver-detail">{a.detail}</pre>}
          <p className="solver-fix"><Wrench size={13} /> {t.fix}</p>
        </div>
      )}

      {c && (
        <div className="solver-card culprit">
          <Package size={20} />
          <div className="grow">
            <strong>{c.name}</strong>
            <span className="muted tiny">{c.file}{c.library ? ` · ${tx("kütüphane")}` : ""}</span>
          </div>
          <span className="solver-tag">{a?.via === "mixin" ? tx("Oyun kodunu değiştiren mod") : a?.via === "loader" ? tx("Yükleyici bildirdi") : tx("Çökme anında çalışıyordu")}</span>
        </div>
      )}

      {c?.library && <p className="hint warn"><AlertTriangle size={14} /> {tx("Bu bir kütüphane; kapatırsan ona bağlı modlar da çalışmaz. Önce güncellemeyi dene.")}</p>}

      {canFix && !fixed && !done && (
        <div className="solver-offer">
          <AshiHead size={30} />
          <div className="grow">
            <strong>{tx("İstersen modun bozuk kısmını ben düzeltebilirim.")}</strong>
            <span className="muted small">{tx("Dosya adlarındaki geçersiz harfleri düzeltip modu yeniden paketlerim. Orijinali yedeklenir; beğenmezsen tek tıkla geri alırsın.")}</span>
          </div>
        </div>
      )}

      {fixed && (
        <div className="solver-card fixed">
          <div className="solver-card-title ok"><Sparkles size={15} /> {tx("Düzelttim!")}</div>
          <p>{tx("{0} dosya adı, {1} kod dosyası ve {2} ayar dosyası düzeltildi. Oyunu yeniden başlatıp dene.", fixed.renamed, fixed.patchedClasses, fixed.patchedFiles)}</p>
          {fixed.examples.length > 0 && <pre className="solver-detail">{fixed.examples.slice(0, 4).map(([x, y]) => `${x.split("/").pop()} → ${y.split("/").pop()}`).join("\n")}</pre>}
          <div className="solver-actions">
            <button className="btn btn-primary" onClick={play}><Play size={15} /> {tx("Oyunu başlat")}</button>
            <button className="btn btn-ghost" onClick={() => void undo()}><Undo2 size={15} /> {tx("Geri al")}</button>
          </div>
        </div>
      )}

      {fixed ? null : done ? <p className="hint ok">{done}</p> : (
        <div className="solver-actions">
          {canFix && <button className="btn btn-primary" disabled={fixing} onClick={() => void fix()}><Wrench size={15} /> {fixing ? tx("Düzeltiyorum…") : tx("Evet, düzelt")}</button>}
          {c && !c.ours && !c.library && <button className={canFix ? "btn btn-ghost" : "btn btn-primary"} onClick={() => void disable()}><PowerOff size={15} /> {tx("Bu modu kapat")}</button>}
          {c && !c.ours && <button className="btn btn-ghost" onClick={goContent}><Download size={15} /> {tx("Güncelleme ara")}</button>}
          {c?.ours && <button className="btn btn-primary" onClick={() => void openUrl("https://github.com/ashistan5200-png/West-Launcher/issues")}>{tx("Hatayı bize bildir")}</button>}
          {a?.cause === "outOfMemory" && <button className="btn btn-primary" onClick={goSettings}><Cpu size={15} /> {tx("Belleği ayarla")}</button>}
          {(a?.cause === "missingDependency" || a?.cause === "missingClass") && <button className="btn btn-ghost" onClick={goContent}><Search size={15} /> {tx("İçeriğe git")}</button>}
          {!c && modCount >= 2 && <button className="btn btn-ghost" onClick={hunt}><Search size={15} /> {tx("Suçlu Avı'nı başlat")}</button>}
        </div>
      )}
      {err && <p className="hint error">{err}</p>}

      {a && (a.exception || a.frame) && (
        <div className="solver-tech">
          <button className="btn-link" onClick={() => setDetails(!details)}><ChevronDown size={14} style={{ transform: details ? "rotate(180deg)" : undefined }} /> {tx("Teknik ayrıntılar")}</button>
          {details && (
            <pre className="solver-detail">
              {[a.description && `Description: ${a.description}`, a.exception, a.frame && `→ ${a.frame}`, `(${a.source})`].filter(Boolean).join("\n")}
            </pre>
          )}
        </div>
      )}
    </Modal>
  );
}
