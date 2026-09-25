import { sql, type SQL } from "drizzle-orm";
import type { Filters } from "../filters";
import { dateRange, likePattern, orderBy, overdue, rows, where } from "./common";

export type PlayerRow = {
  id: number;
  external_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  team_id: number | null;
  team_name: string | null;
  category: string | null;
  branch_id: number | null;
  branch_name: string | null;
  coach_id: number | null;
  coach_name: string | null;
  present: number;
  absent: number;
  sessions: number;
  rate: number | null;
  last_session: string | null;
  invoice_count: number;
  invoiced: number;
  outstanding: number;
  paid: number;
  overdue_count: number;
  overdue_amount: number;
  linked: boolean;
  total: number;
};

const SORTS: Record<string, string> = {
  name: "name",
  team: "team_name",
  branch: "branch_name",
  rate: "rate",
  sessions: "sessions",
  invoiced: "invoiced",
  outstanding: "outstanding",
  last: "last_session",
};

/**
 * One row per player combining attendance (from the attendance app) and finances (from the
 * Odoo invoices of every customer confirmed as linked to the player). The date range, when
 * given, applies to session dates and invoice dates.
 */
export async function listPlayers(
  f: Filters,
  opts: { limit?: number | null; offset?: number; minSessionsForRate?: number } = {},
): Promise<{ rows: PlayerRow[]; total: number }> {
  const base = sql`
    with att as (
      select ar.player_id,
        count(*) filter (where ar.status = 'present')::int as present,
        count(*) filter (where ar.status = 'absent')::int as absent,
        max(s.date)::text as last_session
      from attendance_records ar
      join attendance_sessions s on s.id = ar.session_id and s.deleted_at is null
      where ar.deleted_at is null ${dateRange(sql`s.date`, f.from, f.to)}
        ${f.attendanceStatus ? sql`and ar.status = ${f.attendanceStatus}` : sql``}
      group by ar.player_id
    ), fin as (
      select rl.player_id,
        count(i.id)::int as invoice_count,
        coalesce(sum(i.amount_total_signed), 0)::float8 as invoiced,
        coalesce(sum(i.amount_residual_signed), 0)::float8 as outstanding,
        (count(i.id) filter (where ${overdue("i")}))::int as overdue_count,
        coalesce(sum(i.amount_residual_signed) filter (where ${overdue("i")}), 0)::float8 as overdue_amount
      from record_links rl
      join invoices i on i.customer_id = rl.customer_id and i.deleted_at is null and i.state = 'posted'
      where rl.status = 'confirmed' ${dateRange(sql`i.invoice_date`, f.from, f.to)}
      group by rl.player_id
    ), base as (
      select p.id, p.external_id, p.name, p.email, p.phone,
        t.id as team_id, t.name as team_name, t.category, b.id as branch_id, b.name as branch_name,
        c.id as coach_id, c.name as coach_name,
        coalesce(att.present, 0) as present, coalesce(att.absent, 0) as absent,
        coalesce(att.present, 0) + coalesce(att.absent, 0) as sessions,
        case when coalesce(att.present, 0) + coalesce(att.absent, 0) > 0
          then round(100.0 * att.present / (att.present + att.absent), 1)::float8 end as rate,
        att.last_session,
        coalesce(fin.invoice_count, 0) as invoice_count,
        coalesce(fin.invoiced, 0)::float8 as invoiced,
        coalesce(fin.outstanding, 0)::float8 as outstanding,
        (coalesce(fin.invoiced, 0) - coalesce(fin.outstanding, 0))::float8 as paid,
        coalesce(fin.overdue_count, 0) as overdue_count,
        coalesce(fin.overdue_amount, 0)::float8 as overdue_amount,
        exists (select 1 from record_links rl where rl.player_id = p.id and rl.status = 'confirmed') as linked
      from players p
      left join teams t on t.id = p.team_id
      left join branches b on b.id = p.branch_id
      left join team_coaches tc on tc.team_id = t.id and tc.role = 'coach'
      left join coaches c on c.id = tc.coach_id
      left join att on att.player_id = p.id
      left join fin on fin.player_id = p.id
      where p.deleted_at is null
    )`;

  const conds: (SQL | undefined)[] = [
    f.q ? sql`(name ilike ${likePattern(f.q)} or external_id = ${f.q})` : undefined,
    f.player ? sql`id = ${f.player}` : undefined,
    f.branch ? sql`branch_id = ${f.branch}` : undefined,
    f.team ? sql`team_id = ${f.team}` : undefined,
    f.coach ? sql`team_id in (select team_id from team_coaches where coach_id = ${f.coach})` : undefined,
    f.attMin !== undefined ? sql`rate >= ${f.attMin}` : undefined,
    f.attMax !== undefined ? sql`rate < ${f.attMax}` : undefined,
    f.amountMin !== undefined ? sql`invoiced >= ${f.amountMin}` : undefined,
    f.amountMax !== undefined ? sql`invoiced <= ${f.amountMax}` : undefined,
    f.outMin !== undefined ? sql`outstanding >= ${f.outMin}` : undefined,
    f.outMax !== undefined ? sql`outstanding <= ${f.outMax}` : undefined,
    f.linked === "yes" ? sql`linked` : f.linked === "no" ? sql`not linked` : undefined,
    f.attendanceStatus ? sql`sessions > 0` : undefined,
    opts.minSessionsForRate && (f.attMin !== undefined || f.attMax !== undefined) ? sql`sessions >= ${opts.minSessionsForRate}` : undefined,
    financeCondition(f.finance),
  ];

  const limit = opts.limit === null ? sql`` : sql`limit ${opts.limit ?? 25} offset ${opts.offset ?? 0}`;
  const defaultDir = f.sort && ["rate", "name", "team", "branch"].includes(f.sort) ? "asc" : "desc";
  const result = await rows<PlayerRow>(sql`
    ${base}
    select *, (count(*) over ())::int as total from base
    ${where(conds)}
    ${orderBy(f.sort, f.dir ?? (f.sort ? defaultDir : "asc"), SORTS, "name")}, id
    ${limit}`);
  return { rows: result, total: result[0]?.total ?? 0 };
}

function financeCondition(finance: Filters["finance"]): SQL | undefined {
  switch (finance) {
    case "paid": return sql`invoice_count > 0 and outstanding <= 0.005`;
    case "partial": return sql`outstanding > 0.005 and outstanding < invoiced - 0.005`;
    case "unpaid": return sql`outstanding > 0.005 and outstanding >= invoiced - 0.005`;
    case "outstanding": return sql`outstanding > 0.005`;
    case "overdue": return sql`overdue_count > 0`;
    case "none": return sql`invoice_count = 0`;
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Player profile
// ---------------------------------------------------------------------------

export type PlayerInvoice = {
  id: number;
  odoo_id: number;
  number: string;
  customer_name: string | null;
  move_type: string;
  state: string;
  payment_state: string;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  amount_total: number;
  amount_residual: number;
  amount_paid: number;
  is_overdue: boolean;
  shared_with: number;
};

export async function playerInvoices(playerId: number): Promise<PlayerInvoice[]> {
  return rows<PlayerInvoice>(sql`
    select i.id, i.odoo_id, i.number, oc.name as customer_name, i.move_type, i.state, i.payment_state,
      i.invoice_date::text, i.due_date::text, i.currency,
      i.amount_total_signed::float8 as amount_total, i.amount_residual_signed::float8 as amount_residual,
      (i.amount_total_signed - i.amount_residual_signed)::float8 as amount_paid,
      ${overdue("i")} as is_overdue,
      (select count(*)::int from record_links r2 where r2.customer_id = i.customer_id and r2.status = 'confirmed') as shared_with
    from record_links rl
    join invoices i on i.customer_id = rl.customer_id and i.deleted_at is null and i.state <> 'draft'
    left join odoo_customers oc on oc.id = i.customer_id
    where rl.player_id = ${playerId} and rl.status = 'confirmed'
    order by i.invoice_date desc nulls last, i.id desc`);
}

export type AttendanceHistoryRow = { date: string; team_name: string; status: "present" | "absent" };

export async function playerAttendance(playerId: number): Promise<AttendanceHistoryRow[]> {
  return rows<AttendanceHistoryRow>(sql`
    select s.date::text as date, t.name as team_name, ar.status
    from attendance_records ar
    join attendance_sessions s on s.id = ar.session_id and s.deleted_at is null
    join teams t on t.id = s.team_id
    where ar.player_id = ${playerId} and ar.deleted_at is null
    order by s.date desc`);
}

export type PlayerLink = {
  id: number;
  customer_id: number;
  odoo_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  reference: string | null;
  status: string;
  method: string;
  confidence: number;
};

export async function playerLinks(playerId: number): Promise<PlayerLink[]> {
  return rows<PlayerLink>(sql`
    select rl.id, oc.id as customer_id, oc.odoo_id, oc.name, oc.email, oc.phone, oc.mobile, oc.reference,
      rl.status, rl.method, rl.confidence
    from record_links rl join odoo_customers oc on oc.id = rl.customer_id
    where rl.player_id = ${playerId} and rl.status <> 'rejected'
    order by (rl.status = 'confirmed') desc, rl.confidence desc`);
}

export type PlayerCore = {
  id: number;
  external_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  deleted_at: string | null;
  team_id: number | null;
  team_name: string | null;
  category: string | null;
  branch_id: number | null;
  branch_name: string | null;
  coach_name: string | null;
  assistant_name: string | null;
};

export async function playerCore(playerId: number): Promise<PlayerCore | null> {
  const [row] = await rows<PlayerCore>(sql`
    select p.id, p.external_id, p.name, p.email, p.phone, p.deleted_at::text,
      t.id as team_id, t.name as team_name, t.category, b.id as branch_id, b.name as branch_name,
      (select c.name from team_coaches tc join coaches c on c.id = tc.coach_id where tc.team_id = t.id and tc.role = 'coach') as coach_name,
      (select c.name from team_coaches tc join coaches c on c.id = tc.coach_id where tc.team_id = t.id and tc.role = 'assistant') as assistant_name
    from players p
    left join teams t on t.id = p.team_id
    left join branches b on b.id = p.branch_id
    where p.id = ${playerId}`);
  return row ?? null;
}
