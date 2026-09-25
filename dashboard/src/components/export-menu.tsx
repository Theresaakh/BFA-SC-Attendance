import { Download } from "lucide-react";

/** Excel/PDF download links for a report, carrying the current filters. */
export function ExportButtons({ report, query }: { report: string; query: string }) {
  const q = query.startsWith("?") ? query.slice(1) : query;
  const href = (format: "xlsx" | "pdf") => `/api/reports/${report}?${q ? `${q}&` : ""}format=${format}`;
  const cls = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2";
  return (
    <div className="flex items-center gap-2">
      <a className={cls} href={href("xlsx")} download>
        <Download className="h-3.5 w-3.5" aria-hidden /> Excel
      </a>
      <a className={cls} href={href("pdf")} download>
        <Download className="h-3.5 w-3.5" aria-hidden /> PDF
      </a>
    </div>
  );
}
