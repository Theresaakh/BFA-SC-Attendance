import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { attendanceTone, formatPct, type Tone } from "@/lib/format";

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide text-ink sm:text-[28px]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({ label, value, hint, tone, icon, href }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "bad" | "warn";
  icon?: ReactNode;
  href?: string;
}) {
  const body = (
    <div className={cn("h-full rounded-xl border border-line bg-surface p-4 transition-colors sm:p-5", href && "hover:border-line-strong hover:bg-surface-2")}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        {icon ? <span className="text-muted" aria-hidden>{icon}</span> : null}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-bold tracking-tight sm:text-[28px]",
          tone === "good" && "text-good",
          tone === "bad" && "text-bad",
          tone === "warn" && "text-warn",
          (!tone || tone === "default") && "text-ink",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

const BAR: Record<Tone, string> = {
  green: "bg-good", amber: "bg-warn", red: "bg-bad", orange: "bg-orange", blue: "bg-info", gray: "bg-muted", navy: "bg-navy",
};

/** Attendance meter: bar plus the percentage as text. */
export function RateBar({ rate, threshold, detail, className }: { rate: number | null; threshold: number; detail?: string; className?: string }) {
  const tone = attendanceTone(rate, threshold);
  return (
    <div className={cn("flex min-w-[120px] items-center gap-2", className)} title={detail}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        {rate !== null ? <div className={cn("h-full rounded-full", BAR[tone])} style={{ width: `${Math.max(2, Math.min(100, rate))}%` }} /> : null}
      </div>
      <span className={cn("w-12 text-right text-[13px] font-semibold tabular", rate !== null && rate < threshold ? "text-bad" : "text-ink")}>
        {formatPct(rate)}
      </span>
    </div>
  );
}

export function Alert({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "error"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === "error" ? XCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-xl border px-4 py-3 text-sm",
        tone === "error" && "border-bad/30 bg-bad-soft text-ink",
        tone === "warn" && "border-warn/30 bg-warn-soft text-ink",
        tone === "info" && "border-info/25 bg-info-soft text-ink",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "error" ? "text-bad" : tone === "warn" ? "text-warn" : "text-info")} aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-ink-2">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 rounded-full bg-surface-3 p-3 text-muted">{icon}</div> : null}
      <p className="font-semibold text-ink">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Pagination({ page, total, pageSize, hrefFor }: { page: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = "inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong px-2.5 text-[13px] font-semibold";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted">
      <span className="tabular">
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={cn(link, "hover:bg-surface-2 text-ink")} href={hrefFor(page - 1)} scroll={false}>
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous
          </Link>
        ) : (
          <span className={cn(link, "opacity-40")} aria-disabled>
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous
          </span>
        )}
        <span className="tabular">Page {page} of {pages}</span>
        {page < pages ? (
          <Link className={cn(link, "hover:bg-surface-2 text-ink")} href={hrefFor(page + 1)} scroll={false}>
            Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : (
          <span className={cn(link, "opacity-40")} aria-disabled>
            Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </div>
    </div>
  );
}

export function Tabs({ items, active }: { items: { key: string; label: ReactNode; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Tabs">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
            t.key === active ? "border-brand-red text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] tabular", t.key === active ? "bg-brand-red text-white" : "bg-surface-3 text-ink-2")}>
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[12px] font-semibold uppercase tracking-wider text-muted">{i.label}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
