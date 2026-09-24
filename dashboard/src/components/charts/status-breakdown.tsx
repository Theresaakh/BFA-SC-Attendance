import Link from "next/link";
import { formatMoney } from "@/lib/format";

const STATUS = [
  { key: "paid", label: "Paid", color: "#0ca30c", href: "/invoices?payment=paid" },
  { key: "in_payment", label: "In payment", color: "#2a78d6", href: "/invoices?payment=in_payment" },
  { key: "partial", label: "Partially paid", color: "#fab219", href: "/invoices?payment=partial" },
  { key: "not_paid", label: "Unpaid (not yet due)", color: "#ec835a", href: "/invoices?payment=unpaid" },
  { key: "overdue", label: "Overdue", color: "#d03b3b", href: "/invoices?payment=overdue" },
] as const;

/** Share of customer invoices per payment status: a segmented bar plus a labelled legend. */
export function StatusBreakdown({ data, currency }: { data: { status: string; count: number; amount: number }[]; currency: string }) {
  const by = new Map(data.map((d) => [d.status, d]));
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) return <p className="py-10 text-center text-sm text-muted">No posted invoices yet.</p>;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Invoices by payment status">
        {STATUS.map((s) => {
          const n = by.get(s.key)?.count ?? 0;
          return n ? <div key={s.key} style={{ width: `${(n / total) * 100}%`, background: s.color }} title={`${s.label}: ${n}`} /> : null;
        })}
      </div>
      <ul className="mt-5 space-y-2.5">
        {STATUS.map((s) => {
          const d = by.get(s.key);
          return (
            <li key={s.key}>
              <Link href={s.href} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                <span className="flex-1 text-ink-2">{s.label}</span>
                <span className="font-semibold tabular text-ink">{d?.count ?? 0}</span>
                <span className="w-24 text-right tabular text-muted">{formatMoney(d?.amount ?? 0, currency)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
