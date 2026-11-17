import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Download, History, Loader2 } from "lucide-react";
import clsx from "clsx";
import { Modal } from "@/components/Modal";
import { markdownToHtml } from "@/lib/markdown";
import { api } from "@/lib/ipc";
import { LOADER_LABEL, formatCount, formatRelative } from "@/lib/format";
import type { ContentFile, Instance, ProjectVersion } from "@/lib/types";
import { tx } from "@/lib/i18n";

const TYPE_LABEL = { release: tx("Kararlı"), beta: tx("Beta"), alpha: tx("Alfa") } as const;

/** İçeriğin sürümünü değiştirme: eski bir sürüme dönme ya da belirli bir sürümü seçme. */
export function VersionPicker({ instance, item, onClose, onChanged }: {
  instance: Instance;
  item: ContentFile | null;
  onClose: () => void;
  onChanged: (text: string) => void;
}) {
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!item?.projectId) return;
    setVersions(null); setError(null); setAll(false); setOpen(null);
    api.contentVersions(item.projectId).then(setVersions).catch((e) => setError(String(e).replace(/^Error: /, "")));
  }, [item?.projectId]);

  const fits = (v: ProjectVersion) => {
    if (!v.game_versions.includes(instance.mcVersion)) return false;
    if (item?.kind !== "mod") return true;
    const l = instance.loader.kind;
    return v.loaders.includes(l) || (l === "quilt" && v.loaders.includes("fabric"));
  };
  const list = useMemo(() => (versions ?? []).filter((v) => all || fits(v)), [versions, all]); // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = (versions?.length ?? 0) - (versions ?? []).filter(fits).length;
  const isCurrent = (v: ProjectVersion) => !!item && (v.version_number === item.version || v.files.some((f) => f.filename === item.file));

  const pick = async (v: ProjectVersion) => {
    if (!item) return;
    setBusy(v.id); setError(null);
    try {
      await api.setContentVersion(instance.id, item.id, v.id);
      onChanged(tx("{0} → {1}. Eski dosya yedeklendi.", item.title, v.version_number));
      onClose();
    } catch (e) { setError(String(e).replace(/^Error: /, "")); } finally { setBusy(null); }
  };

  return (
    <Modal open={!!item} onClose={onClose} title={item ? tx("{0} · sürüm seç", item.title) : ""} width={620}>
      <div className="vpick-head">
        <span className="muted small">
          {tx("Şu an:")} <strong>{item?.version ?? item?.file}</strong> · {LOADER_LABEL[instance.loader.kind]} {instance.mcVersion}
        </span>
        <label className="check tiny"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {tx("Uyumsuz sürümleri de göster")}{hidden > 0 && !all ? ` (${hidden})` : ""}</label>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {versions === null && !error ? (
        <div className="center pad"><Loader2 className="spin" size={18} /></div>
      ) : list.length === 0 ? (
        <p className="muted small pad">{tx("Bu instance'a uyan sürüm yok. \"Uyumsuz sürümleri de göster\" ile hepsine bakabilirsin.")}</p>
      ) : (
        <div className="vpick-list">
          {list.map((v) => {
            const cur = isCurrent(v);
            const ok = fits(v);
            return (
              <div key={v.id} className={clsx("vpick-row", cur && "cur", !ok && "bad")}>
                <div className="vpick-main">
                  <div className="row" style={{ gap: 8 }}>
                    <strong className="truncate">{v.version_number}</strong>
                    <span className={`vtype ${v.version_type}`}>{TYPE_LABEL[v.version_type]}</span>
                    {!ok && <span className="chip">{tx("Bu instance'a uymuyor")}</span>}
                  </div>
                  <span className="muted tiny">{formatRelative(v.date_published)} · {formatCount(v.downloads)} {tx("indirme ·")} {v.game_versions.slice(-3).join(", ")}{v.loaders.length ? ` · ${v.loaders.map((l) => LOADER_LABEL[l] ?? l).join(", ")}` : ""}</span>
                  {v.changelog && (
                    <button className="btn-link vpick-notes" onClick={() => setOpen(open === v.id ? null : v.id)}>
                      <ChevronDown size={13} className={clsx(open === v.id && "rot180")} /> {tx("Neler değişti?")}
                    </button>
                  )}
                  {open === v.id && v.changelog && <div className="md vpick-changelog" dangerouslySetInnerHTML={{ __html: markdownToHtml(v.changelog) }} />}
                </div>
                {cur ? (
                  <span className="set-ok"><Check size={14} /> {tx("Kurulu")}</span>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void pick(v)}>
                    {busy === v.id ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {tx("Bu sürümü kur")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="muted tiny"><History size={12} /> {tx("Değiştirmeden önce eski dosya instance'ın yedek klasörüne kopyalanır. Bağımlılıklar değişmez.")}</p>
    </Modal>
  );
}
