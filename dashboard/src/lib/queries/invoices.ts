import { sql, type SQL } from "drizzle-orm";
import type { Filters } from "../filters";
import { dateRange, likePattern, orderBy, overdue, rows, today, where } from "./common";

export type InvoiceRow = {
  id: number;
  odoo_id: number;
  number: string;
  customer_id: number | null;
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
  days_overdue: number | null;
  players: { id: number; name: string }[] | null;
  total: number;
};

const SORTS: Record<string, string> = {
  number: "number",
  customer: "customer_name",
  date: "invoice_date",
  due: "due_date",
  amount: "amount_total",
  outstanding: "amount_residual",
};

function invoiceConds(f: Filters): (SQL | undefined)[] {
  const state = f.invoiceState ?? "posted";
  return [
    sql`i.deleted_at is null`,
    state !== "all" ? sql`i.state = ${state}` : undefined,
    f.q ? sql`(i.number ilike ${likePattern(f.q)} or oc.name ilike ${likePattern(f.q)} or exists (
      select 1 from record_links rl join players p on p.id = rl.player_id
      where rl.customer_id = i.customer_id and rl.status = 'confirmed' and p.name ilike ${likePattern(f.q)}))` : undefined,
    paymentCondition(f.payment),
    f.amountMin !== undefined ? sql`i.amount_total_signed >= ${f.amountMin}` : undefined,
    f.amountMax !== undefined ? sql`i.amount_total_signed <= ${f.amountMax}` : undefined,
    f.outMin !== undefined ? sql`i.amount_residual_signed >= ${f.outMin}` : undefined,
    f.outMax !== undefined ? sql`i.amount_residual_signed <= ${f.outMax}` : undefined,
    f.from ? sql`i.invoice_date >= ${f.from}` : undefined,
    f.to ? sql`i.invoice_date <= ${f.to}` : undefined,
    f.player || f.branch || f.team || f.coach
      ? sql`exists (select 1 from record_links rl join players p on p.id = rl.player_id
          where rl.customer_id = i.customer_id and rl.status = 'confirmed' and p.deleted_at is null
          ${f.player ? sql`and p.id = ${f.player}` : sql``}
          ${f.branch ? sql`and p.branch_id = ${f.branch}` : sql``}
          ${f.team ? sql`and p.team_id = ${f.team}` : sql``}
          ${f.coach ? sql`and p.team_id in (select team_id from team_coaches where coach_id = ${f.coach})` : sql``})`
      : undefined,
    f.linked === "yes"
      ? sql`exists (select 1 from record_links rl where rl.customer_id = i.customer_id and rl.status = 'confirmed')`
      : f.linked === "no"
        ? sql`not exists (select 1 from record_links rl where rl.customer_id = i.customer_id and rl.status = 'confirmed')`
        : undefined,
  ];
}

export async function filteredInvoiceTotals(f: Filters) {
  const [row] = await rows<{ count: number; amount: number; paid: number; outstanding: number; overdue: number }>(sql`
    select count(*)::int as count,
      coalesce(sum(i.amount_total_signed), 0)::float8 as amount,
      coalesce(sum(i.amount_total_signed - i.amount_residual_signed), 0)::float8 as paid,
      coalesce(sum(i.amount_residual_signed), 0)::float8 as outstanding,
      (count(*) filter (where ${overdue("i")}))::int as overdue
    from invoices i left join odoo_customers oc on oc.id = i.customer_id
    ${where(invoiceConds(f))}`);
  return row;
}

export async function listInvoices(f: Filters, opts: { limit?: number | null; offset?: number } = {}) {
  const conds = invoiceConds(f);
  const limit = opts.limit === null ? sql`` : sql`limit ${opts.limit ?? 25} offset ${opts.offset ?? 0}`;
  const result = await rows<InvoiceRow>(sql`
    select i.id, i.odoo_id, i.number, i.customer_id, oc.name as customer_name, i.move_type, i.state, i.payment_state,
      i.invoice_date::text, i.due_date::text, i.currency,
      i.amount_total_signed::float8 as amount_total, i.amount_residual_signed::float8 as amount_residual,
      (i.amount_total_signed - i.amount_residual_signed)::float8 as amount_paid,
      ${overdue("i")} as is_overdue,
      case when ${overdue("i")} then (${today()} - i.due_date) end as days_overdue,
      (select json_agg(json_build_object('id', p.id, 'name', p.name) order by p.name)
        from record_links rl join players p on p.id = rl.player_id
        where rl.customer_id = i.customer_id and rl.status = 'confirmed' and p.deleted_at is null) as players,
      (count(*) over ())::int as total
    from invoices i
    left join odoo_customers oc on oc.id = i.customer_id
    ${where(conds)}
    ${orderBy(f.sort, f.dir ?? (f.sort ? "asc" : "desc"), SORTS, "date")}, i.id desc
    ${limit}`);
  return { rows: result, total: result[0]?.total ?? 0 };
}

export function paymentCondition(payment: Filters["payment"]): SQL | undefined {
  switch (payment) {
    case "paid": return sql`i.payment_state in ('paid', 'reversed')`;
    case "partial": return sql`i.payment_state = 'partial'`;
    case "unpaid": return sql`i.payment_state = 'not_paid'`;
    case "in_payment": return sql`i.payment_state = 'in_payment'`;
    case "open": return sql`i.amount_residual > 0`;
    case "overdue": return overdue("i");
    default: return undefined;
  }
}

export type InvoiceTotals = { count: number; invoiced: number; outstanding: number; paid: number; overdue_count: number; overdue_amount: number };

export async function invoiceTotals(f: Filters): Promise<InvoiceTotals> {
  const [row] = await rows<InvoiceTotals>(sql`
    select count(*)::int as count,
      coalesce(sum(i.amount_total_signed), 0)::float8 as invoiced,
      coalesce(sum(i.amount_residual_signed), 0)::float8 as outstanding,
      coalesce(sum(i.amount_total_signed - i.amount_residual_signed), 0)::float8 as paid,
      (count(*) filter (where ${overdue("i")}))::int as overdue_count,
      coalesce(sum(i.amount_residual_signed) filter (where ${overdue("i")}), 0)::float8 as overdue_amount
    from invoices i
    where i.deleted_at is null and i.state = 'posted' ${dateRange(sql`i.invoice_date`, f.from, f.to)}`);
  return row;
}

export type PaymentRow = {
  id: number;
  name: string | null;
  date: string | null;
  amount: number;
  currency: string | null;
  state: string | null;
  customer_name: string | null;
  players: { id: number; name: string }[] | null;
};

export async function recentPayments(limit = 8): Promise<PaymentRow[]> {
  return rows<PaymentRow>(sql`
    select pay.id, pay.name, pay.date::text, pay.amount::float8 as amount, pay.currency, pay.state, oc.name as customer_name,
      (select json_agg(json_build_object('id', p.id, 'name', p.name) order by p.name)
        from record_links rl join players p on p.id = rl.player_id
        where rl.customer_id = pay.customer_id and rl.status = 'confirmed' and p.deleted_at is null) as players
    from payments pay
    left join odoo_customers oc on oc.id = pay.customer_id
    where pay.deleted_at is null and pay.payment_type = 'inbound'
      and coalesce(pay.state, '') not in ('draft', 'cancel', 'canceled', 'rejected')
    order by pay.date desc nulls last, pay.id desc
    limit ${limit}`);
}

export type MonthlyFinance = { month: string; invoiced: number; collected: number };

/** Invoiced (by invoice date) and collected (by payment date) per month, last `months` months. */
export async function monthlyFinance(months = 12): Promise<MonthlyFinance[]> {
  return rows<MonthlyFinance>(sql`
    with m as (
      select to_char(d, 'YYYY-MM') as month
      from generate_series(date_trunc('month', ${today()}) - make_interval(months => ${months - 1}), date_trunc('month', ${today()}), interval '1 month') d
    ), inv as (
      select to_char(invoice_date, 'YYYY-MM') as month, sum(amount_total_signed)::float8 as invoiced
      from invoices where deleted_at is null and state = 'posted' group by 1
    ), col as (
      select to_char(date, 'YYYY-MM') as month, sum(amount)::float8 as collected
      from payments where deleted_at is null and payment_type = 'inbound' and coalesce(state, '') not in ('draft', 'cancel', 'canceled', 'rejected')
      group by 1
    )
    select m.month, coalesce(inv.invoiced, 0)::float8 as invoiced, coalesce(col.collected, 0)::float8 as collected
    from m left join inv using (month) left join col using (month)
    order by m.month`);
}

export async function paymentStatusBreakdown(f: Filters) {
  return rows<{ status: string; count: number; amount: number }>(sql`
    select case when ${overdue("i")} then 'overdue' else i.payment_state end as status,
      count(*)::int as count, coalesce(sum(i.amount_total_signed), 0)::float8 as amount
    from invoices i
    where i.deleted_at is null and i.state = 'posted' and i.move_type = 'out_invoice' ${dateRange(sql`i.invoice_date`, f.from, f.to)}
    group by 1`);
}

export type UnlinkedCustomerRow = {
  id: number;
  odoo_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  reference: string | null;
  invoice_count: number;
  outstanding: number;
};
