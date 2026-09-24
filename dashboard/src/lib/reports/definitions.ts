import { sql } from "drizzle-orm";
import type { Filters } from "../filters";
import { formatDate, PAYMENT_STATE, playerFinanceStatus } from "../format";
import { getSettings } from "../settings";
import { companyCurrency, dateRange, overdue, rows, today } from "../queries/common";
import { listInvoices } from "../queries/invoices";
import { listPlayers, playerAttendance, playerCore, playerInvoices } from "../queries/players";
import { attendanceByBranch, attendanceByTeam, listRecords, listSessions } from "../queries/attendance";
import { coachHistory, listCoaches } from "../queries/coaches";
import { lookups } from "../queries/lookups";

export type ColumnType = "text" | "money" | "pct" | "int" | "date";
export type Column = { key: string; header: string; type?: ColumnType; width?: number };
export type Section = { title: string; columns: Column[]; rows: Record<string, unknown>[] };
export type ReportOutput = {
  title: string;
  subtitle: string;
  currency: string;
  summary: { label: string; value: string | number; type?: ColumnType }[];
  sections: Section[];
};

export type ReportDef = {
  id: string;
  title: string;
  description: string;
  category: "Financial" | "Attendance" | "Combined";
  /** Which filters the report form offers. */
  filters: ("date" | "branch" | "team" | "coach" | "threshold" | "player")[];
  load: (f: Filters, ctx: { currency: string; threshold: number }) => Promise<Omit<ReportOutput, "subtitle" | "currency">>;
};

const MAX_ROWS = 20000;

const STATUS_LABEL: Record<string, string> = { present: "Present", absent: "Absent" };
const withStatusLabel = <T extends { status: string }>(r: T) => ({ ...r, status: STATUS_LABEL[r.status] ?? r.status });

// ---- shared column sets ---------------------------------------------------------------

const invoiceColumns: Column[] = [
  { key: "number", header: "Invoice", width: 18 },
  { key: "customer", header: "Customer", width: 28 },
  { key: "players", header: "Player(s)", width: 28 },
  { key: "invoice_date", header: "Invoice date", type: "date", width: 13 },
  { key: "due_date", header: "Due date", type: "date", width: 13 },
  { key: "amount", header: "Amount", type: "money", width: 13 },
  { key: "paid", header: "Paid", type: "money", width: 13 },
  { key: "remaining", header: "Remaining", type: "money", width: 13 },
  { key: "status", header: "Payment status", width: 16 },
  { key: "overdue", header: "Overdue", width: 12 },
];

async function invoiceSection(f: Filters, title: string): Promise<{ section: Section; summary: ReportOutput["summary"] }> {
  const { rows: list } = await listInvoices(f, { limit: MAX_ROWS });
  const out = list.map((i) => ({
    number: i.number + (i.move_type === "out_refund" ? " (credit note)" : ""),
    customer: i.customer_name ?? "",
    players: i.players?.map((p) => p.name).join(", ") ?? "",
    invoice_date: i.invoice_date,
    due_date: i.due_date,
    amount: i.amount_total,
    paid: i.amount_paid,
    remaining: i.amount_residual,
    status: i.state === "posted" ? (PAYMENT_STATE[i.payment_state]?.label ?? i.payment_state) : i.state,
    overdue: i.is_overdue ? `${i.days_overdue ?? ""} days` : "",
  }));
  const sum = (k: "amount" | "paid" | "remaining") => out.reduce((s, r) => s + r[k], 0);
  return {
    section: { title, columns: invoiceColumns, rows: out },
    summary: [
      { label: "Invoices", value: out.length, type: "int" },
      { label: "Amount", value: sum("amount"), type: "money" },
      { label: "Paid", value: sum("paid"), type: "money" },
      { label: "Outstanding", value: sum("remaining"), type: "money" },
      { label: "Overdue", value: list.filter((i) => i.is_overdue).length, type: "int" },
    ],
  };
}

const playerSummaryColumns: Column[] = [
  { key: "name", header: "Player", width: 26 },
  { key: "team", header: "Team", width: 16 },
  { key: "branch", header: "Branch", width: 18 },
  { key: "coach", header: "Coach", width: 18 },
  { key: "sessions", header: "Sessions", type: "int", width: 10 },
  { key: "present", header: "Attended", type: "int", width: 10 },
  { key: "absent", header: "Missed", type: "int", width: 10 },
  { key: "rate", header: "Attendance", type: "pct", width: 12 },
  { key: "invoiced", header: "Invoiced", type: "money", width: 13 },
  { key: "paid", header: "Paid", type: "money", width: 13 },
  { key: "outstanding", header: "Outstanding", type: "money", width: 13 },
  { key: "status", header: "Payment status", width: 16 },
];

async function playerSummary(f: Filters, title: string, minSessions = 1) {
  const { rows: list } = await listPlayers(f, { limit: MAX_ROWS, minSessionsForRate: minSessions });
  const out = list.map((p) => ({
    name: p.name,
    team: p.team_name ?? "",
    branch: p.branch_name ?? "",
    coach: p.coach_name ?? "",
    sessions: p.sessions,
    present: p.present,
    absent: p.absent,
    rate: p.rate,
    invoiced: p.invoiced,
    paid: p.paid,
    outstanding: p.outstanding,
    status: p.linked ? playerFinanceStatus(p.invoiced, p.outstanding, p.invoice_count).label + (p.overdue_count ? ` (${p.overdue_count} overdue)` : "") : "Not linked to Odoo",
  }));
  const present = out.reduce((s, r) => s + r.present, 0);
  const total = out.reduce((s, r) => s + r.sessions, 0);
  return {
    sections: [{ title, columns: playerSummaryColumns, rows: out }],
    summary: [
      { label: "Players", value: out.length, type: "int" as const },
      { label: "Attendance", value: total ? Math.round((1000 * present) / total) / 10 : "—", type: "pct" as const },
      { label: "Invoiced", value: out.reduce((s, r) => s + r.invoiced, 0), type: "money" as const },
      { label: "Outstanding", value: out.reduce((s, r) => s + r.outstanding, 0), type: "money" as const },
    ],
  };
}

const groupColumns = (kind: string): Column[] => [
  { key: "name", header: kind, width: 26 },
  ...(kind === "Team" ? [{ key: "branch", header: "Branch", width: 18 }] : []),
  { key: "players", header: "Players", type: "int" as const, width: 10 },
  { key: "sessions", header: "Sessions", type: "int" as const, width: 10 },
  { key: "present", header: "Present", type: "int" as const, width: 10 },
  { key: "absent", header: "Absent", type: "int" as const, width: 10 },
  { key: "rate", header: "Attendance", type: "pct" as const, width: 12 },
];

// ---- report catalogue -----------------------------------------------------------------

export const REPORTS: ReportDef[] = [
  {
    id: "invoices", title: "Customer invoices", category: "Financial",
    description: "All posted customer invoices and credit notes with amounts, payments and status.",
    filters: ["date", "branch", "team"],
    load: async (f) => {
      const r = await invoiceSection(f, "Customer invoices");
      return { title: "Customer invoices", sections: [r.section], summary: r.summary };
    },
  },
  {
    id: "paid-invoices", title: "Paid invoices", category: "Financial",
    description: "Invoices that are fully paid.",
    filters: ["date", "branch", "team"],
    load: async (f) => {
      const r = await invoiceSection({ ...f, payment: "paid" }, "Paid invoices");
      return { title: "Paid invoices", sections: [r.section], summary: r.summary };
    },
  },
  {
    id: "unpaid-invoices", title: "Unpaid invoices", category: "Financial",
    description: "Invoices that are unpaid or only partially paid.",
    filters: ["date", "branch", "team"],
    load: async (f) => {
      const r = await invoiceSection({ ...f, payment: "open" }, "Unpaid invoices");
      return { title: "Unpaid invoices", sections: [r.section], summary: r.summary };
    },
  },
  {
    id: "overdue-invoices", title: "Overdue invoices", category: "Financial",
    description: "Unpaid invoices past their due date, with days overdue.",
    filters: ["date", "branch", "team"],
    load: async (f) => {
      const r = await invoiceSection({ ...f, payment: "overdue", sort: f.sort ?? "due", dir: f.dir ?? "asc" }, "Overdue invoices");
      return { title: "Overdue invoices", sections: [r.section], summary: r.summary };
    },
  },
  {
    id: "outstanding", title: "Outstanding amounts", category: "Financial",
    description: "Outstanding balance per Odoo customer and the player(s) linked to it.",
    filters: ["date", "branch", "team"],
    load: async (f) => {
      const list = await rows<{ customer: string; odoo_id: number; players: string | null; invoices: number; invoiced: number; outstanding: number; overdue: number; oldest_due: string | null }>(sql`
        select oc.name as customer, oc.odoo_id,
          (select string_agg(p.name, ', ' order by p.name) from record_links rl join players p on p.id = rl.player_id
            where rl.customer_id = oc.id and rl.status = 'confirmed' and p.deleted_at is null) as players,
          count(i.id)::int as invoices, sum(i.amount_total_signed)::float8 as invoiced, sum(i.amount_residual_signed)::float8 as outstanding,
          coalesce(sum(i.amount_residual_signed) filter (where ${overdue("i")}), 0)::float8 as overdue,
          min(i.due_date) filter (where i.amount_residual > 0)::text as oldest_due
        from invoices i join odoo_customers oc on oc.id = i.customer_id
        where i.deleted_at is null and i.state = 'posted' and i.amount_residual > 0 ${dateRange(sql`i.invoice_date`, f.from, f.to)}
          ${f.branch || f.team ? sql`and exists (select 1 from record_links rl join players p on p.id = rl.player_id where rl.customer_id = oc.id and rl.status = 'confirmed'
            ${f.branch ? sql`and p.branch_id = ${f.branch}` : sql``} ${f.team ? sql`and p.team_id = ${f.team}` : sql``})` : sql``}
        group by oc.id order by outstanding desc limit ${MAX_ROWS}`);
      return {
        title: "Outstanding amounts",
        summary: [
          { label: "Customers", value: list.length, type: "int" },
          { label: "Outstanding", value: list.reduce((s, r) => s + r.outstanding, 0), type: "money" },
          { label: "Of which overdue", value: list.reduce((s, r) => s + r.overdue, 0), type: "money" },
        ],
        sections: [{
          title: "Outstanding by customer",
          columns: [
            { key: "customer", header: "Customer", width: 28 }, { key: "players", header: "Player(s)", width: 30 },
            { key: "invoices", header: "Open invoices", type: "int", width: 12 }, { key: "outstanding", header: "Outstanding", type: "money", width: 14 },
            { key: "overdue", header: "Overdue", type: "money", width: 14 }, { key: "oldest_due", header: "Oldest due date", type: "date", width: 15 },
          ],
          rows: list.map((r) => ({ ...r, players: r.players ?? "Not linked" })),
        }],
      };
    },
  },
  {
    id: "monthly-financial", title: "Monthly financial summary", category: "Financial",
    description: "Per month: invoices issued, amount invoiced, amount collected and what is still outstanding.",
    filters: ["date"],
    load: async (f) => {
      const list = await rows<{ month: string; invoices: number; invoiced: number; collected: number; outstanding: number; overdue: number }>(sql`
        with inv as (
          select to_char(invoice_date, 'YYYY-MM') as month, count(*)::int as invoices, sum(amount_total_signed)::float8 as invoiced,
            sum(amount_residual_signed)::float8 as outstanding, coalesce(sum(amount_residual_signed) filter (where ${overdue("invoices")}), 0)::float8 as overdue
          from invoices where deleted_at is null and state = 'posted' and invoice_date is not null ${dateRange(sql`invoice_date`, f.from, f.to)} group by 1
        ), col as (
          select to_char(date, 'YYYY-MM') as month, sum(amount)::float8 as collected from payments
          where deleted_at is null and payment_type = 'inbound' and coalesce(state, '') not in ('draft', 'cancel', 'canceled', 'rejected')
            ${dateRange(sql`date`, f.from, f.to)} group by 1
        )
        select month, coalesce(inv.invoices, 0) as invoices, coalesce(inv.invoiced, 0)::float8 as invoiced,
          coalesce(col.collected, 0)::float8 as collected, coalesce(inv.outstanding, 0)::float8 as outstanding, coalesce(inv.overdue, 0)::float8 as overdue
        from inv full join col using (month) order by month desc`);
      return {
        title: "Monthly financial summary",
        summary: [
          { label: "Invoiced", value: list.reduce((s, r) => s + r.invoiced, 0), type: "money" },
          { label: "Collected", value: list.reduce((s, r) => s + r.collected, 0), type: "money" },
          { label: "Outstanding", value: list.reduce((s, r) => s + r.outstanding, 0), type: "money" },
        ],
        sections: [{
          title: "By month",
          columns: [
            { key: "month", header: "Month", width: 12 }, { key: "invoices", header: "Invoices", type: "int", width: 10 },
            { key: "invoiced", header: "Invoiced", type: "money", width: 14 }, { key: "collected", header: "Collected", type: "money", width: 14 },
            { key: "outstanding", header: "Outstanding", type: "money", width: 14 }, { key: "overdue", header: "Overdue", type: "money", width: 14 },
          ],
          rows: list,
        }],
      };
    },
  },
  {
    id: "player-attendance", title: "Player attendance", category: "Attendance",
    description: "Sessions, attendance and absences for every player.",
    filters: ["date", "branch", "team", "coach"],
    load: async (f) => {
      const r = await playerSummary({ ...f, sort: f.sort ?? "name" }, "Player attendance");
      const cols = playerSummaryColumns.filter((c) => !["invoiced", "paid", "outstanding", "status"].includes(c.key));
      return { title: "Player attendance", summary: r.summary.slice(0, 2), sections: [{ ...r.sections[0], columns: cols }] };
    },
  },
  {
    id: "coach-attendance", title: "Coach attendance", category: "Attendance",
    description: "Sessions attended and missed by each coach, with full history when one coach is selected.",
    filters: ["date", "branch", "team", "coach"],
    load: async (f) => {
      const { rows: list } = await listCoaches(f, { limit: MAX_ROWS });
      const sections: Section[] = [{
        title: "Coaches",
        columns: [
          { key: "name", header: "Coach", width: 24 }, { key: "teams", header: "Teams", width: 30 }, { key: "branches", header: "Branch", width: 20 },
          { key: "sessions", header: "Sessions", type: "int", width: 10 }, { key: "present", header: "Attended", type: "int", width: 10 },
          { key: "absent", header: "Missed", type: "int", width: 10 }, { key: "rate", header: "Attendance", type: "pct", width: 12 },
          { key: "last_session", header: "Last session", type: "date", width: 14 },
        ],
        rows: list.map((c) => ({ ...c, teams: c.teams?.map((t) => t.name + (t.role === "assistant" ? " (asst.)" : "")).join(", ") ?? "", branches: c.branches?.join(", ") ?? "" })),
      }];
      if (f.coach) {
        const hist = await coachHistory(f.coach, f);
        sections.push({
          title: "Attendance history",
          columns: [
            { key: "date", header: "Date", type: "date", width: 13 }, { key: "team_name", header: "Team", width: 20 }, { key: "branch_name", header: "Branch", width: 18 },
            { key: "role", header: "Role", width: 12 }, { key: "status", header: "Status", width: 10 }, { key: "replacement_name", header: "Replaced by", width: 20 },
          ],
          rows: hist.map((h) => ({ ...withStatusLabel(h), role: h.role === "coach" ? "Head coach" : "Assistant" })),
        });
      }
      const present = list.reduce((s, r) => s + r.present, 0);
      const total = list.reduce((s, r) => s + r.sessions, 0);
      return {
        title: f.coach && list[0] ? `Coach attendance — ${list[0].name}` : "Coach attendance",
        summary: [
          { label: "Coaches", value: list.length, type: "int" },
          { label: "Sessions", value: total, type: "int" },
          { label: "Attendance", value: total ? Math.round((1000 * present) / total) / 10 : "—", type: "pct" },
        ],
        sections,
      };
    },
  },
  {
    id: "team-attendance", title: "Team attendance", category: "Attendance",
    description: "Attendance rate per team.",
    filters: ["date", "branch", "team", "coach"],
    load: async (f) => {
      const list = await attendanceByTeam(f);
      return { title: "Team attendance", summary: [{ label: "Teams", value: list.length, type: "int" }], sections: [{ title: "Teams", columns: groupColumns("Team"), rows: list.map((t) => ({ ...t, branch: t.branch_name ?? "" })) }] };
    },
  },
  {
    id: "branch-attendance", title: "Branch attendance", category: "Attendance",
    description: "Attendance rate per branch.",
    filters: ["date", "branch"],
    load: async (f) => {
      const list = await attendanceByBranch(f);
      return { title: "Branch attendance", summary: [{ label: "Branches", value: list.length, type: "int" }], sections: [{ title: "Branches", columns: groupColumns("Branch"), rows: list }] };
    },
  },
  {
    id: "sessions", title: "Attendance by date range", category: "Attendance",
    description: "Every training session in the period with players present and coach attendance.",
    filters: ["date", "branch", "team", "coach"],
    load: async (f) => {
      const { rows: list } = await listSessions(f, { limit: MAX_ROWS });
      return {
        title: "Attendance by date range",
        summary: [
          { label: "Sessions", value: list.length, type: "int" },
          { label: "Player attendance", value: (() => { const p = list.reduce((s, r) => s + r.present, 0); const t = list.reduce((s, r) => s + r.present + r.absent, 0); return t ? Math.round((1000 * p) / t) / 10 : "—"; })(), type: "pct" },
        ],
        sections: [{
          title: "Sessions",
          columns: [
            { key: "date", header: "Date", type: "date", width: 13 }, { key: "team_name", header: "Team", width: 20 }, { key: "branch_name", header: "Branch", width: 18 },
            { key: "present", header: "Present", type: "int", width: 10 }, { key: "absent", header: "Absent", type: "int", width: 10 }, { key: "rate", header: "Attendance", type: "pct", width: 12 },
            { key: "coach", header: "Coach", width: 26 }, { key: "assistant", header: "Assistant", width: 22 },
          ],
          rows: list.map((s) => ({
            ...s,
            coach: s.coach_status ? `${s.coach_name ?? "Coach"}: ${s.coach_status}${s.coach_replacement ? ` (replaced by ${s.coach_replacement})` : ""}` : "Not recorded",
            assistant: s.assistant_status ? `${s.assistant_name ?? "Assistant"}: ${s.assistant_status}` : "",
          })),
        }],
      };
    },
  },
  {
    id: "attendance-records", title: "Attendance records", category: "Attendance",
    description: "Individual present/absent records, e.g. every absence in a period.",
    filters: ["date", "branch", "team", "coach", "player"],
    load: async (f) => {
      const { rows: list } = await listRecords(f, { limit: MAX_ROWS });
      return {
        title: f.attendanceStatus === "absent" ? "Absences" : "Attendance records",
        summary: [{ label: "Records", value: list.length, type: "int" }, { label: "Absent", value: list.filter((r) => r.status === "absent").length, type: "int" }],
        sections: [{
          title: "Records",
          columns: [
            { key: "date", header: "Date", type: "date", width: 13 }, { key: "player_name", header: "Player", width: 26 },
            { key: "team_name", header: "Team", width: 20 }, { key: "branch_name", header: "Branch", width: 18 }, { key: "status", header: "Status", width: 10 },
          ],
          rows: list.map(withStatusLabel),
        }],
      };
    },
  },
  {
    id: "unpaid-low-attendance", title: "Unpaid invoices + low attendance", category: "Combined",
    description: "Players with an outstanding balance whose attendance is below the threshold.",
    filters: ["date", "branch", "team", "coach", "threshold"],
    load: async (f, ctx) => {
      const r = await playerSummary({ ...f, finance: "outstanding", attMax: f.attMax ?? ctx.threshold, sort: f.sort ?? "outstanding", dir: f.dir ?? "desc" }, "Players");
      return { title: `Unpaid invoices and attendance below ${f.attMax ?? ctx.threshold}%`, ...r };
    },
  },
  {
    id: "player-summary", title: "Player financial + attendance", category: "Combined",
    description: "Every player with attendance and invoice totals side by side.",
    filters: ["date", "branch", "team", "coach", "threshold"],
    load: async (f) => ({ title: "Player financial and attendance report", ...(await playerSummary(f, "Players")) }),
  },
  {
    id: "player-profile", title: "Player profile", category: "Combined",
    description: "One player's invoices and complete attendance history.",
    filters: ["player"],
    load: async (f) => {
      if (!f.player) throw new ReportInputError("Choose a player.");
      const core = await playerCore(f.player);
      if (!core) throw new ReportInputError("Player not found.");
      const [sum, inv, hist] = await Promise.all([listPlayers({ player: f.player }, { limit: 1 }), playerInvoices(f.player), playerAttendance(f.player)]);
      const s = sum.rows[0];
      return {
        title: `Player report — ${core.name}`,
        summary: [
          { label: "Team", value: [core.team_name, core.branch_name].filter(Boolean).join(" · ") || "—" },
          { label: "Invoiced", value: s?.invoiced ?? 0, type: "money" },
          { label: "Paid", value: s?.paid ?? 0, type: "money" },
          { label: "Outstanding", value: s?.outstanding ?? 0, type: "money" },
          { label: "Sessions", value: `${s?.present ?? 0}/${s?.sessions ?? 0}` },
          { label: "Attendance", value: s?.rate ?? "—", type: "pct" },
        ],
        sections: [
          {
            title: "Invoices",
            columns: invoiceColumns.filter((c) => c.key !== "players"),
            rows: inv.map((i) => ({
              number: i.number, customer: i.customer_name ?? "", invoice_date: i.invoice_date, due_date: i.due_date, amount: i.amount_total,
              paid: i.amount_paid, remaining: i.amount_residual, status: PAYMENT_STATE[i.payment_state]?.label ?? i.payment_state, overdue: i.is_overdue ? "Yes" : "",
            })),
          },
          {
            title: "Attendance history",
            columns: [{ key: "date", header: "Date", type: "date", width: 14 }, { key: "team_name", header: "Team", width: 22 }, { key: "status", header: "Status", width: 12 }],
            rows: hist.map(withStatusLabel),
          },
        ],
      };
    },
  },
];

export class ReportInputError extends Error {}

const FINANCE_LABEL: Record<string, string> = {
  paid: "fully paid", partial: "partially paid", unpaid: "unpaid", overdue: "has overdue invoices", none: "no invoices", outstanding: "has unpaid invoices",
};
const PAYMENT_LABEL: Record<string, string> = {
  paid: "paid", partial: "partially paid", unpaid: "unpaid", in_payment: "in payment", overdue: "overdue", open: "not fully paid",
};

export function findReport(id: string) {
  return REPORTS.find((r) => r.id === id) ?? null;
}

/** Runs a report and adds a human-readable description of the filters used. */
export async function runReport(def: ReportDef, f: Filters): Promise<ReportOutput> {
  const [currency, settings, look] = await Promise.all([companyCurrency(), getSettings(), lookups()]);
  const body = await def.load(f, { currency, threshold: settings.lowAttendanceThreshold });
  const name = (list: { id: number; name: string }[], id?: number) => list.find((x) => x.id === id)?.name;
  const uses = (k: ReportDef["filters"][number]) => def.filters.includes(k);
  const parts = [
    !uses("date") ? null : f.from || f.to ? `Period: ${f.from ? formatDate(f.from) : "start"} – ${f.to ? formatDate(f.to) : formatDate(await todayString())}` : "Period: all time",
    uses("branch") && f.branch ? `Branch: ${name(look.branches, f.branch) ?? f.branch}` : null,
    uses("team") && f.team ? `Team: ${name(look.teams, f.team) ?? f.team}` : null,
    uses("coach") && f.coach ? `Coach: ${name(look.coaches, f.coach) ?? f.coach}` : null,
    f.attMax !== undefined && def.id !== "unpaid-low-attendance" ? `Attendance below ${f.attMax}%` : null,
    f.attMin !== undefined ? `Attendance at least ${f.attMin}%` : null,
    f.finance ? `Payment status: ${FINANCE_LABEL[f.finance]}` : null,
    f.payment && !["paid-invoices", "unpaid-invoices", "overdue-invoices"].includes(def.id) ? `Payment status: ${PAYMENT_LABEL[f.payment]}` : null,
    f.attendanceStatus && def.id !== "attendance-records" ? `Counting ${f.attendanceStatus} only` : null,
    f.linked ? (f.linked === "yes" ? "Linked to Odoo" : "Not linked to Odoo") : null,
    f.q ? `Search: "${f.q}"` : null,
  ].filter(Boolean);
  return { ...body, currency, subtitle: parts.join(" · ") || "Beirut Football Academy" };
}

async function todayString(): Promise<string> {
  const [r] = await rows<{ d: string }>(sql`select ${today()}::text as d`);
  return r.d;
}
