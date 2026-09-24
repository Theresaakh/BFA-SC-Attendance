import Link from "next/link";
import { AlertTriangle, CalendarCheck, CircleDollarSign, FileWarning, ReceiptText, UserRound, Users, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { bfaConfig, odooConfig } from "@/lib/env";
import { parseFilters, toQuery, type RawSearchParams } from "@/lib/filters";
import { formatDate, formatMoney, formatNumber, formatPct, todayIso } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getSyncOverview } from "@/lib/sync/runner";
import { companyCurrency } from "@/lib/queries/common";
import { invoiceTotals, monthlyFinance, paymentStatusBreakdown, recentPayments } from "@/lib/queries/invoices";
import { attendanceByBranch, attendanceByTeam, attendanceTotals, listSessions, weeklyAttendance } from "@/lib/queries/attendance";
import { listPlayers, type PlayerRow } from "@/lib/queries/players";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState, PageHeader, RateBar, StatCard } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { FinanceChart } from "@/components/charts/finance-chart";
import { AttendanceChart } from "@/components/charts/attendance-chart";
import { StatusBreakdown } from "@/components/charts/status-breakdown";
import { cn } from "@/lib/cn";

export const metadata = { title: "Dashboard" };

function shiftDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUser();
  const f = parseFilters(await searchParams);
  const period = { from: f.from, to: f.to, branch: f.branch };
  const settings = await getSettings();
  const threshold = settings.lowAttendanceThreshold;

  const [currency, fin, breakdown, monthly, payments, att, weekly, byBranch, byTeam, sessions, sync, lowAtt, unpaid, both] = await Promise.all([
    companyCurrency(),
    invoiceTotals(period),
    paymentStatusBreakdown(period),
    monthlyFinance(12),
    recentPayments(6),
    attendanceTotals(period),
    weeklyAttendance(12, period),
    attendanceByBranch(period),
    attendanceByTeam(period),
    listSessions(period, { limit: 6 }),
    getSyncOverview(),
    listPlayers({ ...period, attMax: threshold, sort: "rate", dir: "asc" }, { limit: 6, minSessionsForRate: 1 }),
    listPlayers({ ...period, finance: "outstanding", sort: "outstanding", dir: "desc" }, { limit: 6 }),
    listPlayers({ ...period, finance: "outstanding", attMax: threshold, sort: "outstanding", dir: "desc" }, { limit: 6, minSessionsForRate: 1 }),
  ]);

  const today = todayIso();
  const presets = [
    { label: "All time", q: {} },
    { label: "Last 30 days", q: { from: shiftDays(today, -30), to: today } },
    { label: "Last 90 days", q: { from: shiftDays(today, -90), to: today } },
    { label: "This year", q: { from: `${today.slice(0, 4)}-01-01`, to: today } },
  ];
  const activePreset = presets.find((p) => (p.q as { from?: string }).from === f.from && (p.q as { to?: string }).to === f.to);
  const neverSynced = sync.sources.every((s) => !s.lastSuccessAt);
  const failing = sync.sources.filter((s) => s.lastRun?.status === "failed");
  const notConfigured = [!odooConfig().configured && "Odoo", !bfaConfig().configured && "BFA attendance"].filter(Boolean);
  const periodLabel = f.from || f.to ? `${f.from ? formatDate(f.from) : "start"} – ${f.to ? formatDate(f.to) : "today"}` : "All time";

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Finance and attendance overview · ${periodLabel}`}
        actions={
          <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1">
            {presets.map((p) => (
              <Link
                key={p.label}
                href={`/${toQuery({ ...p.q, branch: f.branch })}`}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-semibold",
                  (activePreset ? activePreset === p : p.label === "All time" && !f.from && !f.to) ? "bg-brand-navy text-white dark:bg-navy dark:text-navy-deep" : "text-ink-2 hover:bg-surface-2",
                )}
              >
                {p.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="mb-6 space-y-3">
        {notConfigured.length ? (
          <Alert tone="warn" title={`${notConfigured.join(" and ")} not configured`} action={<LinkButton href="/settings" size="sm">Open settings</LinkButton>}>
            Add the missing credentials to the server environment (see <code>.env.example</code>) to start synchronising.
          </Alert>
        ) : null}
        {failing.map((s) => (
          <Alert key={s.source} tone="error" title={`Last ${s.source === "odoo" ? "Odoo" : "attendance"} synchronisation failed`} action={<LinkButton href={`/sync/${s.lastRun!.id}`} size="sm">View log</LinkButton>}>
            {s.lastRun?.message}
          </Alert>
        ))}
        {neverSynced && !notConfigured.length ? <Alert tone="info" title="No data yet">Press “Sync now” to import invoices and attendance for the first time.</Alert> : null}
      </div>

      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted">Financial overview</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Total invoices" value={formatNumber(fin.count)} hint="Posted customer invoices" icon={<ReceiptText className="h-4 w-4" />} href="/invoices" />
        <StatCard label="Invoiced" value={formatMoney(fin.invoiced, currency)} hint="Net of credit notes" icon={<CircleDollarSign className="h-4 w-4" />} />
        <StatCard label="Paid" value={formatMoney(fin.paid, currency)} tone="good" hint={fin.invoiced ? `${formatPct((fin.paid / fin.invoiced) * 100)} collected` : undefined} icon={<Wallet className="h-4 w-4" />} href="/invoices?payment=paid" />
        <StatCard label="Outstanding" value={formatMoney(fin.outstanding, currency)} tone={fin.outstanding > 0 ? "bad" : "default"} icon={<FileWarning className="h-4 w-4" />} href="/invoices?payment=open" />
        <StatCard label="Unpaid invoices" value={formatNumber(breakdown.filter((b) => ["not_paid", "partial", "overdue", "in_payment"].includes(b.status)).reduce((s, b) => s + b.count, 0))} hint="Unpaid or partially paid" href="/invoices?payment=open" />
        <StatCard label="Overdue" value={formatNumber(fin.overdue_count)} tone={fin.overdue_count ? "bad" : "default"} hint={`${formatMoney(fin.overdue_amount, currency)} past due`} icon={<AlertTriangle className="h-4 w-4" />} href="/invoices?payment=overdue" />
      </div>

      <h2 className="mb-3 mt-7 text-[12px] font-semibold uppercase tracking-wider text-muted">Attendance overview</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Player attendance" value={formatPct(att.player_rate, 1)} tone={att.player_rate !== null && att.player_rate < threshold ? "bad" : "default"} hint={`${formatNumber(att.player_present)} present · ${formatNumber(att.player_absent)} absent`} icon={<Users className="h-4 w-4" />} href="/attendance" />
        <StatCard label="Coach attendance" value={formatPct(att.coach_rate, 1)} tone={att.coach_rate !== null && att.coach_rate < threshold ? "bad" : "default"} hint={`${formatNumber(att.coach_present)} present · ${formatNumber(att.coach_absent)} absent`} icon={<UserRound className="h-4 w-4" />} href="/coaches" />
        <StatCard label="Sessions" value={formatNumber(att.sessions)} hint="Training sessions recorded" icon={<CalendarCheck className="h-4 w-4" />} href="/attendance" />
        <StatCard label="Low attendance" value={formatNumber(lowAtt.total)} tone={lowAtt.total ? "warn" : "default"} hint={`Players below ${threshold}%`} href={`/players${toQuery({ attMax: threshold, sort: "rate", dir: "asc" })}`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Invoiced vs collected" subtitle="Last 12 months, by invoice date and payment date" />
          <CardBody><FinanceChart data={monthly} currency={currency} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Payment status" subtitle="Customer invoices" />
          <CardBody><StatusBreakdown data={breakdown} currency={currency} /></CardBody>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Weekly attendance" subtitle="Share of recorded players and coaches present, last 12 weeks" />
          <CardBody><AttendanceChart data={weekly} threshold={threshold} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent payments" action={<LinkButton href="/invoices?payment=paid" size="sm" variant="ghost">All</LinkButton>} />
          {payments.length ? (
            <ul className="divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {p.players?.length ? <Link className="hover:underline" href={`/players/${p.players[0].id}`}>{p.players.map((x) => x.name).join(", ")}</Link> : p.customer_name ?? "Unknown customer"}
                    </p>
                    <p className="truncate text-xs text-muted">{formatDate(p.date)} · {p.name ?? "Payment"}</p>
                  </div>
                  <span className="text-sm font-semibold tabular text-good">{formatMoney(p.amount, p.currency ?? currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No payments yet" />
          )}
        </Card>
      </div>

      <h2 className="mb-3 mt-7 text-[12px] font-semibold uppercase tracking-wider text-muted">Needs attention</h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <AttentionList
          title="Unpaid & low attendance"
          subtitle={`Outstanding balance and attendance below ${threshold}%`}
          rows={both.rows}
          total={both.total}
          href={`/players${toQuery({ finance: "outstanding", attMax: threshold, sort: "outstanding", dir: "desc" })}`}
          currency={currency}
          threshold={threshold}
          highlight
        />
        <AttentionList title="Players with unpaid invoices" subtitle="Largest outstanding balances" rows={unpaid.rows} total={unpaid.total}
          href={`/players${toQuery({ finance: "outstanding", sort: "outstanding", dir: "desc" })}`} currency={currency} threshold={threshold} />
        <AttentionList title="Players with low attendance" subtitle={`Below ${threshold}%`} rows={lowAtt.rows} total={lowAtt.total}
          href={`/players${toQuery({ attMax: threshold, sort: "rate", dir: "asc" })}`} currency={currency} threshold={threshold} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Attendance by branch" action={<LinkButton href="/attendance?tab=branches" size="sm" variant="ghost">Details</LinkButton>} />
          <GroupList rows={byBranch} threshold={threshold} hrefFor={(id) => `/players?branch=${id}`} />
        </Card>
        <Card>
          <CardHeader title="Attendance by team" action={<LinkButton href="/attendance?tab=teams" size="sm" variant="ghost">Details</LinkButton>} />
          <GroupList rows={byTeam} threshold={threshold} hrefFor={(id) => `/players?team=${id}`} sub />
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Recent sessions" action={<LinkButton href="/attendance" size="sm" variant="ghost">All sessions</LinkButton>} />
        {sessions.rows.length ? (
          <ul className="divide-y divide-line">
            {sessions.rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <span className="w-28 text-sm font-semibold tabular text-ink">{formatDate(s.date)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{s.team_name}{s.branch_name ? ` · ${s.branch_name}` : ""}</span>
                <span className="text-sm tabular text-ink-2">{s.present}/{s.present + s.absent} present</span>
                {s.coach_status ? (
                  <Badge tone={s.coach_status === "present" ? "green" : "red"}>Coach {s.coach_status}</Badge>
                ) : (
                  <Badge tone="gray">Coach not recorded</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No sessions recorded yet" />
        )}
      </Card>
    </>
  );
}

function AttentionList({ title, subtitle, rows, total, href, currency, threshold, highlight }: {
  title: string; subtitle: string; rows: PlayerRow[]; total: number; href: string; currency: string; threshold: number; highlight?: boolean;
}) {
  return (
    <Card className={cn(highlight && "border-bad/40")}>
      <CardHeader
        title={<span className="flex items-center gap-2">{title} <Badge tone={total ? (highlight ? "red" : "amber") : "gray"} dot={false}>{total}</Badge></span>}
        subtitle={subtitle}
        action={<LinkButton href={href} size="sm" variant="ghost">View all</LinkButton>}
      />
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={`/players/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                  <p className="truncate text-xs text-muted">{[p.team_name, p.branch_name].filter(Boolean).join(" · ") || "No team"}</p>
                </div>
                <div className="text-right">
                  {p.outstanding > 0 ? <p className="text-sm font-semibold tabular text-bad">{formatMoney(p.outstanding, currency)}</p> : null}
                  <p className={cn("text-xs tabular", p.rate !== null && p.rate < threshold ? "font-semibold text-bad" : "text-muted")}>
                    {p.rate !== null ? `${formatPct(p.rate)} · ${p.present}/${p.sessions}` : "No sessions"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing to review" />
      )}
    </Card>
  );
}

function GroupList({ rows, threshold, hrefFor, sub }: { rows: { id: number; name: string; branch_name?: string | null; sessions: number; present: number; absent: number; rate: number | null; players: number }[]; threshold: number; hrefFor: (id: number) => string; sub?: boolean }) {
  if (!rows.length) return <EmptyState title="No data yet" />;
  return (
    <ul className="max-h-96 divide-y divide-line overflow-y-auto">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={hrefFor(r.id)} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
              <p className="truncate text-xs text-muted">
                {sub && r.branch_name ? `${r.branch_name} · ` : ""}{r.players} players · {r.sessions} sessions
              </p>
            </div>
            <RateBar rate={r.rate} threshold={threshold} detail={`${r.present} present / ${r.absent} absent`} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
