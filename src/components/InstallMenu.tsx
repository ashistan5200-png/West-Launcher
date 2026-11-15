import { useState } from "react";
import { Check, ChevronDown, Download, Loader2 } from "lucide-react";
import type { ContentHit, Instance } from "@/lib/types";
import { useContent, contentKey } from "@/stores/content";
import { LOADER_LABEL } from "@/lib/format";
import { Menu } from "./instance/Menu";
import { InstanceIcon } from "./InstanceIcon";

/** İçerik bu instance'a kurulabilir mi? Değilse nedeni. */
export function incompatibility(hit: ContentHit, inst: Instance): string | null {
  if (hit.versions?.length && !hit.versions.includes(inst.mcVersion)) return `Minecraft ${inst.mcVersion} desteklenmiyor`;
  if (hit.kind === "mod") {
    if (inst.loader.kind === "vanilla") return "Vanilla instance'a mod kurulamaz";
    const l = hit.loaders ?? [];
    const ok = !l.length || l.includes(inst.loader.kind) || (inst.loader.kind === "quilt" && l.includes("fabric"));
    if (!ok) return `${LOADER_LABEL[inst.loader.kind]} desteklenmiyor`;
  }
  return null;
}

/** "Ekle ▾": hedef instance seçimi (modpack'lerde doğrudan "Kur"). */
export function InstallMenu({ hit, instances, preferred, direct }: { hit: ContentHit; instances: Instance[]; preferred: Instance | null; direct?: boolean }) {
  const installing = useContent((s) => !!s.installing[contentKey(hit)]);
  const install = useContent((s) => s.install);
  // Instance'tan açılan Keşfet: tek tıkla o instance'a, uyumlu en son sürüm kurulur
  const installed = useContent((s) => !!preferred && !!s.installed[preferred.id]?.has(contentKey(hit)));
  const [done, setDone] = useState<string | null>(null);
  const run = async (inst: Instance | null) => {
    await install(hit, inst?.id ?? null);
    setDone(inst?.name ?? "yeni instance");
  };

  if (hit.kind === "modpack") {
    return (
      <button className="btn btn-primary" disabled={installing} onClick={() => void run(null)} title={done ? `→ ${done}` : undefined}>
        {installing ? <Loader2 size={15} className="spin" /> : done ? <Check size={15} /> : <Download size={15} />} {done ? "Kuruldu" : "Kur"}
      </button>
    );
  }
  if (direct && preferred) {
    const why = incompatibility(hit, preferred);
    return (
      <button className={installed ? "btn btn-ghost" : "btn btn-primary"} disabled={installing || installed || !!why} title={why ?? `${preferred.name} için uyumlu en son sürüm kurulur`} onClick={() => void run(preferred)}>
        {installing ? <Loader2 size={15} className="spin" /> : installed || done ? <Check size={15} /> : <Download size={15} />} {installed ? "Kurulu" : why ? "Uyumsuz" : "Kur"}
      </button>
    );
  }
  return (
    <Menu
      trigger={() => (
        <button className="btn btn-primary" disabled={installing} title={done ? `→ ${done}` : undefined}>
          {installing ? <Loader2 size={15} className="spin" /> : done ? <Check size={15} /> : <Download size={15} />} {done ? "Eklendi" : "Ekle"} <ChevronDown size={14} />
        </button>
      )}
      items={
        instances.length === 0
          ? [{ label: "Önce bir instance oluştur", disabled: true, onClick: () => {} }]
          : [...instances]
              .sort((a, b) => (a.id === preferred?.id ? -1 : b.id === preferred?.id ? 1 : Number(!!incompatibility(hit, a)) - Number(!!incompatibility(hit, b))))
              .map((inst) => {
                const why = incompatibility(hit, inst);
                return {
                  label: why ? `${inst.name} — ${why}` : `${inst.name} · ${LOADER_LABEL[inst.loader.kind]} ${inst.mcVersion}`,
                  icon: <InstanceIcon instance={inst} size={18} />,
                  disabled: !!why,
                  onClick: () => void run(inst),
                };
              })
      }
    />
  );
}
