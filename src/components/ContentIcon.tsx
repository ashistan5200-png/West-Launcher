import { useState } from "react";
import { Image as ImageIcon, Package, Palette, Sparkles } from "lucide-react";
import type { ContentKind } from "@/lib/types";

const KIND_ICON = { mod: Package, modpack: Package, shader: Sparkles, resourcepack: Palette } satisfies Record<ContentKind, unknown>;

/** Başlıktan deterministik, düşük doygunluklu ton — palete uyumlu yedek ikon için. */
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11);

interface Props {
  src: string | null;
  title: string;
  kind: ContentKind;
  size: number;
}

/**
 * Proje ikonu (Modrinth `icon_url` / CurseForge `logo.thumbnailUrl`).
 * - `loading="lazy"` + `decoding="async"`: yalnızca ekrana gelen ikonlar indirilir, ana iş parçacığı bloklanmaz
 * - sabit width/height: liste kaymaz (layout shift yok)
 * - yüklenince yumuşak belirme; hata veya boş URL'de baş harfli yedek ikon
 */
export function ContentIcon({ src, title, kind, size }: Props) {
  const [state, setState] = useState<"loading" | "ok" | "error">(src ? "loading" : "error");
  const radius = Math.round(size * 0.23);

  if (!src || state === "error") {
    const h = hue(title);
    const Icon = KIND_ICON[kind] ?? ImageIcon;
    return (
      <div
        className="content-icon fallback"
        style={{
          width: size, height: size, borderRadius: radius,
          background: `linear-gradient(150deg, hsl(${h} 16% 30%), hsl(${h} 14% 21%))`,
        }}
        aria-hidden
      >
        <span style={{ fontSize: size * 0.4 }}>{title.trim().charAt(0).toUpperCase() || "?"}</span>
        <Icon size={Math.max(10, size * 0.24)} className="fallback-kind" />
      </div>
    );
  }

  return (
    <div className={`content-icon ${state === "loading" ? "loading" : ""}`} style={{ width: size, height: size, borderRadius: radius }}>
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onLoad={() => setState("ok")}
        onError={() => setState("error")}
      />
    </div>
  );
}
