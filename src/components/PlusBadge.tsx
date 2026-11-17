import { useId } from "react";

/**
 * West+ işareti: altın tonlu, köşeleri yumuşatılmış bir elmasın içinde artı.
 * Temanın vurgu renginden bağımsızdır; West+ her temada aynı altın renkte görünür.
 */
export function PlusMark({ size = 16 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="plus-mark">
      <defs>
        <linearGradient id={`pg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE7A3" />
          <stop offset="0.5" stopColor="#F2B654" />
          <stop offset="1" stopColor="#C8782C" />
        </linearGradient>
      </defs>
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="4.2" transform="rotate(45 12 12)" fill={`url(#pg${id})`} />
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="4.2" transform="rotate(45 12 12)" fill="none" stroke="#FFF4D2" strokeOpacity="0.55" strokeWidth="0.8" />
      <path d="M12 7.6v8.8M7.6 12h8.8" stroke="#2A1A08" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** "◆+ PLUS" rozeti. size: işaret boyutu; yazı orantılı büyür. */
export function PlusBadge({ size = 14, label = true, className = "" }: { size?: number; label?: boolean; className?: string }) {
  return (
    <span className={`plus-badge ${className}`} style={{ fontSize: Math.round(size * 0.72) }} aria-label="West Plus">
      <PlusMark size={size} />
      {label && <span className="plus-word">PLUS</span>}
    </span>
  );
}
