import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

type Props = { page: number; pages: number; onPageChange: (page: number) => void };

const pageList = (page: number, pages: number): (number | "…")[] => {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const list: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) list.push("…");
  for (let i = start; i <= end; i += 1) list.push(i);
  if (end < pages - 1) list.push("…");
  list.push(pages);
  return list;
};

const Pagination = ({ page, pages, onPageChange }: Props) => {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-center gap-1" aria-label="Pagination">
      <button className="btn-secondary px-3" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" />
      </button>
      {pageList(page, pages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-2 text-slate-400">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={cn("min-w-[40px] rounded-lg px-3 py-2 text-sm font-semibold", p === page ? "bg-primary-600 text-white" : "text-slate-700 hover:bg-slate-100")}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </button>
        )
      )}
      <button className="btn-secondary px-3" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
};

export default Pagination;
