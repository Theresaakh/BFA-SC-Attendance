import Link from "next/link";
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("border-b border-line bg-surface-2 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted whitespace-nowrap", className)} {...props}>
      {children}
    </th>
  );
}

export function Td({ className, children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("border-b border-line px-4 py-3 align-middle text-ink", className)} {...props}>
      {children}
    </td>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("hover:bg-surface-2/70", className)}>{children}</tr>;
}

/** Column header that links to the same page sorted by `sortKey`. */
export function SortTh({ label, sortKey, current, dir, hrefFor, className }: {
  label: string;
  sortKey: string;
  current?: string;
  dir?: "asc" | "desc";
  hrefFor: (sort: string, dir: "asc" | "desc") => string;
  className?: string;
}) {
  const active = current === sortKey;
  const nextDir = active && dir === "asc" ? "desc" : active && dir === "desc" ? "asc" : "asc";
  const Icon = !active ? ArrowUpDown : dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <Th className={className} aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : undefined}>
      <Link href={hrefFor(sortKey, nextDir)} className="inline-flex items-center gap-1 hover:text-ink" scroll={false}>
        {label}
        <Icon className={cn("h-3 w-3", active ? "text-ink" : "opacity-50")} aria-hidden />
      </Link>
    </Th>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-muted">
        {children}
      </td>
    </tr>
  );
}
