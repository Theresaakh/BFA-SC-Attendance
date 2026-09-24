import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, CalendarX, Link2, Link2Off, ReceiptText } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { formatDate, formatMoney, formatPct, INVOICE_STATE, PAYMENT_STATE, playerFinanceStatus } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { companyCurrency } from "@/lib/queries/common";
import { listPlayers, playerAttendance, playerCore, playerInvoices, playerLinks } from "@/lib/queries/players";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, Table, Td, Th, Tr } from "@/components/ui/table";
import { Alert, KeyValue, RateBar } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { ExportButtons } from "@/components/export-menu";
import { cn } from "@/lib/cn";

export const metadata = { title: "Player" };

const METHOD: Record<string, string> = {
  player_id: "Player ID", email: "E-mail", phone: "Phone", name_exact: "Exact name", name_fuzzy: "Similar name", manual: "Manual",
};

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const core = await playerCore(id);
  if (!core) notFound();

  const [settings, currency, summary, invoices, history, links] = await Promise.all([
    getSettings(),
    companyCurrency(),
    listPlayers({ player: id }, { limit: 1 }),
    playerInvoices(id),
    playerAttendance(id),
    playerLinks(id),
  ]);
  const s = summary.rows[0];
  const threshold = settings.lowAttendanceThreshold;
  const status = s ? playerFinanceStatus(s.invoiced, s.outstanding, s.invoice_count) : { label: "No invoices", tone: "gray" as const };
  const confirmed = links.filter((l) => l.status === "confirmed");
  const suggested = links.filter((l) => l.status === "suggested");

  // Attendance per month for the history card.
  const byMonth = new Map<string, { present: number; absent: number }>();
  for (const h of history) {
    const m = h.date.slice(0, 7);
    const e = byMonth.get(m) ?? { present: 0, absent: 0 };
    e[h.status]++;
    byMonth.set(m, e);
  }
  const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <>
      <Link href="/players" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Players
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-ink">{core.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {core.team_name ? <Badge tone="navy" dot={false}>{core.team_name}</Badge> : null}
            {core.category ? <Badge tone="gray" dot={false}>{core.category}</Badge> : null}
            {core.branch_name ? <span>{core.branch_name}</span> : null}
            {core.coach_name ? <span className="text-muted">· Coach {core.coach_name}</span> : null}
            {core.deleted_at ? <Badge tone="red">Removed from attendance app</Badge> : null}
          </div>
        </div>
        <ExportButtons report="player-profile" query={`?player=${id}`} />
      </div>

      {!confirmed.length ? (
        <div className="mb-6">
          <Alert tone="warn" title="Not linked to an Odoo customer" action={<LinkButton href={`/matching?tab=players&q=${encodeURIComponent(core.name)}`} size="sm">Link now</LinkButton>}>
            {suggested.length ? `${suggested.length} possible match(es) are waiting for review.` : "No invoices can be shown until this player is linked to their Odoo customer record."}
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Financial summary" action={<Badge tone={status.tone}>{status.label}</Badge>} />
          <CardBody className="grid grid-cols-3 gap-4">
            <Metric label="Total invoiced" value={formatMoney(s?.invoiced ?? 0, currency)} />
            <Metric label="Paid" value={formatMoney(s?.paid ?? 0, currency)} tone="good" />
            <Metric label="Outstanding" value={formatMoney(s?.outstanding ?? 0, currency)} tone={(s?.outstanding ?? 0) > 0 ? "bad" : undefined} />
            {s?.overdue_count ? (
              <p className="col-span-3 text-sm text-bad">
                {s.overdue_count} overdue invoice(s) · {formatMoney(s.overdue_amount, currency)} past due
              </p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Attendance summary" action={s?.rate !== null && s?.rate !== undefined ? <Badge tone={s.rate < threshold ? "red" : "green"}>{s.rate < threshold ? "Low attendance" : "On track"}</Badge> : null} />
          <CardBody>
            <div className="grid grid-cols-4 gap-4">
              <Metric label="Sessions" value={String(s?.sessions ?? 0)} />
              <Metric label="Attended" value={String(s?.present ?? 0)} tone="good" />
              <Metric label="Missed" value={String(s?.absent ?? 0)} tone={(s?.absent ?? 0) > 0 ? "bad" : undefined} />
              <Metric label="Attendance" value={formatPct(s?.rate ?? null, 1)} />
            </div>
            <RateBar rate={s?.rate ?? null} threshold={threshold} className="mt-4" />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Player" />
          <CardBody>
            <KeyValue
              items={[
                { label: "Name", value: core.name },
                { label: "Player ID", value: <code className="text-xs">{core.external_id}</code> },
                { label: "E-mail", value: core.email ?? confirmed.find((l) => l.email)?.email ?? "—" },
                { label: "Phone", value: core.phone ?? confirmed.map((l) => l.phone ?? l.mobile).find(Boolean) ?? "—" },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Team" />
          <CardBody>
            <KeyValue
              items={[
                { label: "Team", value: core.team_id ? <Link className="hover:underline" href={`/players?team=${core.team_id}`}>{core.team_name}</Link> : "—" },
                { label: "Category", value: core.category ?? "—" },
                { label: "Branch", value: core.branch_id ? <Link className="hover:underline" href={`/players?branch=${core.branch_id}`}>{core.branch_name}</Link> : "—" },
                { label: "Coach", value: [core.coach_name, core.assistant_name && `${core.assistant_name} (assistant)`].filter(Boolean).join(", ") || "—" },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Odoo customer" action={<LinkButton href={`/matching?tab=players&q=${encodeURIComponent(core.name)}`} size="sm" variant="ghost">Manage</LinkButton>} />
          <CardBody className="space-y-3">
            {confirmed.length ? confirmed.map((l) => (
              <div key={l.id} className="flex items-start gap-2">
                <Link2 className="mt-0.5 h-4 w-4 text-good" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
                  <p className="text-xs text-muted">Odoo #{l.odoo_id} · matched by {METHOD[l.method] ?? l.method}</p>
                </div>
              </div>
            )) : (
              <p className="flex items-center gap-2 text-sm text-muted"><Link2Off className="h-4 w-4" aria-hidden /> Not linked</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Invoices" subtitle={`${invoices.length} customer invoice(s) from Odoo`} />
        <Table>
          <thead>
            <tr>
              <Th>Invoice</Th>
              <Th>Invoice date</Th>
              <Th>Due date</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Remaining</Th>
              <Th>Payment status</Th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => {
              const ps = PAYMENT_STATE[i.payment_state] ?? { label: i.payment_state, tone: "gray" as const };
              return (
                <Tr key={i.id}>
                  <Td>
                    <p className="font-semibold">{i.number}</p>
                    <p className="text-xs text-muted">
                      {i.move_type === "out_refund" ? "Credit note · " : ""}{i.customer_name}
                      {i.shared_with > 1 ? ` · shared by ${i.shared_with} players` : ""}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap tabular">{formatDate(i.invoice_date)}</Td>
                  <Td className={cn("whitespace-nowrap tabular", i.is_overdue && "font-semibold text-bad")}>{formatDate(i.due_date)}</Td>
                  <Td className="text-right tabular">{formatMoney(i.amount_total, i.currency ?? currency)}</Td>
                  <Td className="text-right tabular text-ink-2">{formatMoney(i.amount_paid, i.currency ?? currency)}</Td>
                  <Td className={cn("text-right tabular font-semibold", i.amount_residual > 0 ? "text-bad" : "text-ink-2")}>{formatMoney(i.amount_residual, i.currency ?? currency)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {i.state !== "posted" ? <Badge tone={INVOICE_STATE[i.state]?.tone ?? "gray"}>{INVOICE_STATE[i.state]?.label ?? i.state}</Badge> : <Badge tone={ps.tone}>{ps.label}</Badge>}
                      {i.is_overdue ? <Badge tone="red" dot={false}>Overdue</Badge> : null}
                    </div>
                  </Td>
                </Tr>
              );
            })}
            {!invoices.length ? (
              <EmptyRow colSpan={7}>
                <ReceiptText className="mx-auto mb-2 h-6 w-6" aria-hidden />
                {confirmed.length ? "No invoices for the linked customer." : "Link this player to an Odoo customer to see invoices."}
              </EmptyRow>
            ) : null}
          </tbody>
        </Table>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Attendance by month" />
          {months.length ? (
            <ul className="divide-y divide-line">
              {months.map(([m, v]) => {
                const total = v.present + v.absent;
                const [y, mo] = m.split("-").map(Number);
                return (
                  <li key={m} className="grid grid-cols-[110px_1fr] items-center gap-3 px-5 py-2.5">
                    <div>
                      <p className="text-sm font-semibold text-ink">{new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}</p>
                      <p className="text-xs tabular text-muted">{v.present}/{total} sessions</p>
                    </div>
                    <RateBar rate={total ? Math.round((1000 * v.present) / total) / 10 : null} threshold={threshold} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-muted">No attendance recorded.</p>
          )}
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Attendance history" subtitle="Every recorded session, most recent first" />
          {history.length ? (
            <div className="max-h-[480px] overflow-y-auto">
              <Table>
                <thead>
                  <tr><Th>Date</Th><Th>Team</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <Tr key={`${h.date}-${h.team_name}`}>
                      <Td className="whitespace-nowrap tabular">{formatDate(h.date)}</Td>
                      <Td className="text-ink-2">{h.team_name}</Td>
                      <Td>
                        {h.status === "present" ? (
                          <Badge tone="green"><CalendarCheck className="h-3 w-3" aria-hidden /> Present</Badge>
                        ) : (
                          <Badge tone="red"><CalendarX className="h-3 w-3" aria-hidden /> Absent</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-muted">No attendance recorded.</p>
          )}
        </Card>
      </div>
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-1 truncate text-xl font-bold tabular", tone === "good" && "text-good", tone === "bad" && "text-bad", !tone && "text-ink")}>{value}</p>
    </div>
  );
}
