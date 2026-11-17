import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Import, Plus, Search } from "lucide-react";
import { useOnboarding } from "@/stores/onboarding";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { InstanceCard } from "@/components/InstanceCard";
import { CreateInstanceModal } from "@/components/CreateInstanceModal";
import type { LoaderKind } from "@/lib/types";
import { LOADER_LABEL } from "@/lib/format";
import { tx } from "@/lib/i18n";

type Filter = "all" | "templates" | LoaderKind;

export function LibraryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const instances = useInstances((s) => s.instances);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return instances.filter((i) => {
      if (filter === "templates" ? !i.isTemplate : i.isTemplate) return false;
      if (filter !== "all" && filter !== "templates" && i.loader.kind !== filter) return false;
      return !q || i.name.toLowerCase().includes(q) || i.mcVersion.includes(q);
    });
  }, [instances, query, filter]);

  const filters: Filter[] = ["all", "fabric", "quilt", "forge", "neoforge", "vanilla", "templates"];

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <input placeholder={tx("Instance ara…")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="pills">
          {filters.map((f) => (
            <button key={f} className={clsx("pill", filter === f && "active")} onClick={() => setFilter(f)}>
              {f === "all" ? tx("Tümü") : f === "templates" ? tx("Şablonlar") : LOADER_LABEL[f]}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => useOnboarding.getState().openWizard()} title={tx("Modrinth App, CurseForge, Prism, MultiMC veya resmi launcher'dan")}>
          <Import size={15} /> {tx("Aktar")}
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => setParams({ new: "1" })}>
          <Plus size={15} /> {tx("Yeni")}
        </button>
      </div>

      {filtered.length ? (
        <div className="grid">{filtered.map((i) => <InstanceCard key={i.id} instance={i} />)}</div>
      ) : (
        <p className="muted center pad">{tx("Eşleşen instance yok.")}</p>
      )}

      <CreateInstanceModal
        open={params.get("new") === "1"}
        onClose={() => setParams({})}
        onCreated={(id) => navigate(`/instance/${id}`)}
      />
    </div>
  );
}
