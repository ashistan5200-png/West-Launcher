import { Check, Download, ExternalLink, Loader2 } from "lucide-react";
import { ContentIcon } from "./ContentIcon";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import clsx from "clsx";
import type { ContentHit } from "@/lib/types";
import { useContent, contentKey } from "@/stores/content";
import { formatCount } from "@/lib/format";
import { tx } from "@/lib/i18n";

const SOURCE_LABEL = { modrinth: tx("Modrinth"), curseforge: tx("CurseForge") } as const;

interface Props {
  hit: ContentHit;
  instanceId: string | null;
  /** Ashi'nin gerekçesi (sohbet kartlarında) */
  reason?: string;
  compact?: boolean;
}

/** Arama sonucu / Ashi önerisi — tek tıkla kurulum düğmesiyle. */
export function ContentRow({ hit, instanceId, reason, compact = false }: Props) {
  const installing = useContent((s) => !!s.installing[contentKey(hit)]);
  const installed = useContent((s) => s.isInstalled(instanceId, hit));
  const install = useContent((s) => s.install);
  const needsInstance = hit.kind !== "modpack" && !instanceId;

  return (
    <div className={clsx("content-row", compact && "compact")}>
      <ContentIcon key={hit.icon ?? hit.id} src={hit.icon} title={hit.title} kind={hit.kind} size={compact ? 36 : 52} />
      <div className="content-meta">
        <div className="content-title">
          <strong className="truncate">{hit.title}</strong>
          {!compact && hit.author && <span className="muted tiny truncate">{hit.author}</span>}
        </div>
        <p className={clsx("content-desc", compact && "clamp-2")}>{reason ?? hit.description}</p>
        <div className="content-tags">
          <span className={`source-badge ${hit.source}`}>{SOURCE_LABEL[hit.source]}</span>
          {hit.alsoOn && <span className="tiny muted">+ {SOURCE_LABEL[hit.alsoOn]}</span>}
          <span className="tiny muted"><Download size={11} /> {formatCount(hit.downloads)}</span>
          {!compact && hit.categories.slice(0, 3).map((c) => <span key={c} className="chip">{c}</span>)}
        </div>
      </div>
      <div className="content-actions">
        <button
          className={clsx("btn btn-sm", installed ? "btn-ghost" : "btn-primary")}
          disabled={installing || installed || needsInstance}
          title={needsInstance ? tx("Önce bir instance seç") : undefined}
          onClick={() => install(hit, instanceId)}
        >
          {installing ? <Loader2 size={14} className="spin" /> : installed ? <Check size={14} /> : <Download size={14} />}
          {installed ? tx("Kurulu") : hit.kind === "modpack" ? tx("Kur") : tx("Ekle")}
        </button>
        {!compact && (
          <button className="icon-btn" title={tx("Sayfasını aç")} onClick={() => openUrl(hit.url)}>
            <ExternalLink size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
