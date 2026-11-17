import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import clsx from "clsx";
import { tx } from "@/lib/i18n";

/** Sayfa düğmeleri: ilk, önceki, numaralar, sonraki, son ve "sayfaya git". */
export function Pagination({ page, pages, onChange, disabled }: { page: number; pages: number; onChange: (p: number) => void; disabled?: boolean }) {
  const [jump, setJump] = useState(String(page));
  useEffect(() => setJump(String(page)), [page]);
  if (pages <= 1) return null;
  const go = (p: number) => {
    const n = Math.min(pages, Math.max(1, Math.round(p)));
    if (n !== page) onChange(n);
  };
  // 1 … 4 5 [6] 7 8 … 40
  const nums: (number | "…")[] = [];
  const win = 2;
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= win) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <nav className="pager" aria-label={tx("Sayfalar")}>
      <button className="pg-btn" disabled={disabled || page === 1} onClick={() => go(1)} title={tx("İlk sayfa")}><ChevronsLeft size={16} /></button>
      <button className="pg-btn" disabled={disabled || page === 1} onClick={() => go(page - 1)} title={tx("Önceki sayfa")}><ChevronLeft size={16} /> <span>{tx("Önceki")}</span></button>
      <div className="pg-nums">
        {nums.map((n, i) =>
          n === "…" ? <span key={`e${i}`} className="pg-gap">…</span> : (
            <button key={n} className={clsx("pg-num", n === page && "on")} disabled={disabled} onClick={() => go(n)}>{n.toLocaleString("tr-TR")}</button>
          ),
        )}
      </div>
      <button className="pg-btn" disabled={disabled || page === pages} onClick={() => go(page + 1)} title={tx("Sonraki sayfa")}><span>{tx("Sonraki")}</span> <ChevronRight size={16} /></button>
      <button className="pg-btn" disabled={disabled || page === pages} onClick={() => go(pages)} title={tx("Son sayfa")}><ChevronsRight size={16} /></button>
      <form className="pg-jump" onSubmit={(e) => { e.preventDefault(); const n = parseInt(jump, 10); if (!Number.isNaN(n)) go(n); }}>
        <span className="muted small">{tx("Sayfa")}</span>
        <input inputMode="numeric" value={jump} onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))} aria-label={tx("Sayfa numarası")} />
        <span className="muted small">/ {pages.toLocaleString("tr-TR")}</span>
        <button className="btn btn-ghost btn-sm" type="submit" disabled={disabled}>{tx("Git")}</button>
      </form>
    </nav>
  );
}
