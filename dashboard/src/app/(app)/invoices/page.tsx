import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { PAGE_SIZE, parseFilters, toQuery, type RawSearchParams } from "@/lib/filters";
import { formatDate, formatMoney, formatNumber, INVOICE_STATE, PAYMENT_STATE } from "@/lib/format";
import { companyCurrency } from "@/lib/queries/common";
import { filteredInvoiceTotals, listInvoices } from "@/lib/queries/invoices";
import { lookups } from "@/lib/queries/lookups";
import { Card } from "@/components/ui/card";
import { EmptyRow, SortTh, Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Pagination, StatCard } from "@/components/ui/misc";
import { FilterBar, optionsFrom } from "@/components/filter-bar";
import { ExportButtons } from "@/components/export-menu";
import { cn } from "@/lib/cn";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUser();
  const f = parseFilters(await searchParams);
  const page = f.page ?? 1;
  const [currency, look, data, totals] = await Promise.all([
    companyCurrency(),
    lookups(),
    listInvoices(f, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    filteredInvoiceTotals(f),
  ]);
  const sortHref = (sort: string, dir: "asc" | "desc") => `/invoices${toQuery({ ...f, page: undefined }, { sort, dir })}`;

  return (
    <>
      <PageHeader title="Invoices" subtitle="Customer invoices and credit notes synchronised from Odoo" actions={<ExportButtons report="invoices" query={toQuery({ ...f, page: undefined })} />} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Invoices" value={formatNumber(totals.count)} hint="Matching the filters" />
        <StatCard label="Amount" value={formatMoney(totals.amount, currency)} />
        <StatCard label="Paid" value={formatMoney(totals.paid, currency)} tone="good" />
        <StatCard label="Outstanding" value={formatMoney(totals.outstanding, currency)} tone={totals.outstanding > 0 ? "bad" : "default"} hint={totals.overdue ? `${totals.overdue} overdue` : undefined} />
      </div>
      <FilterBar
        action="/invoices"
        filters={f}
        primary={[
          { name: "q", label: "Search", type: "search", placeholder: "Invoice number, customer or player" },
          {
            name: "payment", label: "Payment status", type: "select",
            options: [
              { value: "open", label: "Not fully paid" },
              { value: "overdue", label: "Overdue" },
              { value: "unpaid", label: "Unpaid" },
              { value: "partial", label: "Partially paid" },
              { value: "in_payment", label: "In payment" },
              { value: "paid", label: "Paid" },
            ],
          },
          { name: "from", label: "Invoice date from", type: "date" },
          { name: "to", label: "Invoice date to", type: "date" },
        ]}
        more={[
          { name: "invoiceState", label: "Invoice status", type: "select", placeholder: "Posted (default)", options: [{ value: "draft", label: "Draft" }, { value: "cancel", label: "Cancelled" }, { value: "all", label: "All statuses" }] },
          { name: "branch", label: "Branch (of linked player)", type: "select", options: optionsFrom(look.branches) },
          { name: "team", label: "Team (of linked player)", type: "select", options: optionsFrom(look.teams) },
          { name: "amountMin", label: "Amount at least", type: "number" },
          { name: "amountMax", label: "Amount at most", type: "number" },
          { name: "outMin", label: "Outstanding at least", type: "number" },
          { name: "outMax", label: "Outstanding at most", type: "number" },
          { name: "linked", label: "Player link", type: "select", options: [{ value: "yes", label: "Linked to a player" }, { value: "no", label: "Not linked" }] },
        ]}
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <SortTh label="Invoice" sortKey="number" current={f.sort} dir={f.dir} hrefFor={sortHref} />
              <SortTh label="Customer" sortKey="customer" current={f.sort} dir={f.dir} hrefFor={sortHref} />
              <Th>Player</Th>
              <SortTh label="Date" sortKey="date" current={f.sort} dir={f.dir} hrefFor={sortHref} />
              <SortTh label="Due" sortKey="due" current={f.sort} dir={f.dir} hrefFor={sortHref} />
              <SortTh label="Amount" sortKey="amount" current={f.sort} dir={f.dir} hrefFor={sortHref} className="text-right" />
              <Th className="text-right">Paid</Th>
              <SortTh label="Remaining" sortKey="outstanding" current={f.sort} dir={f.dir} hrefFor={sortHref} className="text-right" />
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((i) => {
              const ps = PAYMENT_STATE[i.payment_state] ?? { label: i.payment_state, tone: "gray" as const };
              return (
                <Tr key={i.id}>
                  <Td className="whitespace-nowrap font-semibold">{i.number}{i.move_type === "out_refund" ? <span className="ml-1.5 text-xs font-normal text-muted">Credit note</span> : null}</Td>
                  <Td className="max-w-[220px] truncate text-ink-2">{i.customer_name ?? "—"}</Td>
                  <Td>
                    {i.players?.length ? (
                      <div className="flex flex-col">
                        {i.players.slice(0, 3).map((p) => <Link key={p.id} href={`/players/${p.id}`} className="truncate hover:underline">{p.name}</Link>)}
                        {i.players.length > 3 ? <span className="text-xs text-muted">+{i.players.length - 3} more</span> : null}
                      </div>
                    ) : (
                      <Link href={`/matching?tab=customers&q=${encodeURIComponent(i.customer_name ?? "")}`} className="text-xs font-semibold text-warn hover:underline">Link player</Link>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap tabular">{formatDate(i.invoice_date)}</Td>
                  <Td className={cn("whitespace-nowrap tabular", i.is_overdue && "font-semibold text-bad")}>
                    {formatDate(i.due_date)}
                    {i.is_overdue && i.days_overdue ? <p className="text-xs font-normal">{i.days_overdue} d overdue</p> : null}
                  </Td>
                  <Td className="text-right tabular">{formatMoney(i.amount_total, i.currency ?? currency)}</Td>
                  <Td className="text-right tabular text-ink-2">{formatMoney(i.amount_paid, i.currency ?? currency)}</Td>
                  <Td className={cn("text-right tabular font-semibold", i.amount_residual > 0 ? "text-bad" : "text-ink-2")}>{formatMoney(i.amount_residual, i.currency ?? currency)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {i.state === "posted" ? <Badge tone={ps.tone}>{ps.label}</Badge> : <Badge tone={INVOICE_STATE[i.state]?.tone ?? "gray"}>{INVOICE_STATE[i.state]?.label ?? i.state}</Badge>}
                      {i.is_overdue ? <Badge tone="red" dot={false}>Overdue</Badge> : null}
                    </div>
                  </Td>
                </Tr>
              );
            })}
            {!data.rows.length ? (
              <EmptyRow colSpan={9}><ReceiptText className="mx-auto mb-2 h-6 w-6" aria-hidden />No invoices match these filters.</EmptyRow>
            ) : null}
          </tbody>
        </Table>
        <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} hrefFor={(pg) => `/invoices${toQuery(f, { page: pg })}`} />
      </Card>
    </>
  );
}
