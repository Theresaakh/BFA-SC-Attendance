import { sql } from "drizzle-orm";
import { likePattern, rows } from "./common";

export type SuggestionRow = {
  link_id: number;
  confidence: number;
  method: string;
  reasons: string[];
  player_id: number;
  player_name: string;
  player_external_id: string;
  team_name: string | null;
  branch_name: string | null;
  customer_id: number;
  customer_odoo_id: number;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  customer_reference: string | null;
  invoice_count: number;
  outstanding: number;
};

export async function suggestions(): Promise<SuggestionRow[]> {
  return rows<SuggestionRow>(sql`
    select rl.id as link_id, rl.confidence, rl.method, rl.reasons,
      p.id as player_id, p.name as player_name, p.external_id as player_external_id, t.name as team_name, b.name as branch_name,
      oc.id as customer_id, oc.odoo_id as customer_odoo_id, oc.name as customer_name, oc.email as customer_email,
      coalesce(oc.phone, oc.mobile) as customer_phone, oc.reference as customer_reference,
      (select count(*)::int from invoices i where i.customer_id = oc.id and i.deleted_at is null and i.state = 'posted') as invoice_count,
      (select coalesce(sum(i.amount_residual_signed), 0)::float8 from invoices i where i.customer_id = oc.id and i.deleted_at is null and i.state = 'posted') as outstanding
    from record_links rl
    join players p on p.id = rl.player_id and p.deleted_at is null
    join odoo_customers oc on oc.id = rl.customer_id and oc.deleted_at is null
    left join teams t on t.id = p.team_id
    left join branches b on b.id = p.branch_id
    where rl.status = 'suggested'
      and not exists (select 1 from record_links c where c.player_id = p.id and c.status = 'confirmed')
    order by rl.confidence desc, p.name`);
}

export type UnmatchedPlayerRow = { id: number; name: string; external_id: string; team_name: string | null; branch_name: string | null; suggestions: number; sessions: number };

export async function unmatchedPlayers(q?: string): Promise<UnmatchedPlayerRow[]> {
  return rows<UnmatchedPlayerRow>(sql`
    select p.id, p.name, p.external_id, t.name as team_name, b.name as branch_name,
      (select count(*)::int from record_links rl where rl.player_id = p.id and rl.status = 'suggested') as suggestions,
      (select count(*)::int from attendance_records ar where ar.player_id = p.id and ar.deleted_at is null) as sessions
    from players p
    left join teams t on t.id = p.team_id
    left join branches b on b.id = p.branch_id
    where p.deleted_at is null
      and not exists (select 1 from record_links rl where rl.player_id = p.id and rl.status = 'confirmed')
      ${q ? sql`and p.name ilike ${likePattern(q)}` : sql``}
    order by p.name`);
}

export type UnmatchedCustomerRow = {
  id: number; odoo_id: number; name: string; email: string | null; phone: string | null; reference: string | null;
  invoice_count: number; invoiced: number; outstanding: number;
};

export async function unmatchedCustomers(q?: string): Promise<UnmatchedCustomerRow[]> {
  return rows<UnmatchedCustomerRow>(sql`
    select oc.id, oc.odoo_id, oc.name, oc.email, coalesce(oc.phone, oc.mobile) as phone, oc.reference,
      count(i.id)::int as invoice_count, coalesce(sum(i.amount_total_signed), 0)::float8 as invoiced,
      coalesce(sum(i.amount_residual_signed), 0)::float8 as outstanding
    from odoo_customers oc
    join invoices i on i.customer_id = oc.id and i.deleted_at is null and i.state = 'posted'
    where oc.deleted_at is null
      and not exists (select 1 from record_links rl where rl.customer_id = oc.id and rl.status = 'confirmed')
      ${q ? sql`and (oc.name ilike ${likePattern(q)} or oc.email ilike ${likePattern(q)})` : sql``}
    group by oc.id
    order by outstanding desc, oc.name`);
}

export type ConfirmedLinkRow = {
  link_id: number; method: string; confidence: number; decided_at: string | null; decided_by: string | null;
  player_id: number; player_name: string; team_name: string | null; customer_id: number; customer_odoo_id: number; customer_name: string;
};

export async function confirmedLinks(q?: string): Promise<ConfirmedLinkRow[]> {
  return rows<ConfirmedLinkRow>(sql`
    select rl.id as link_id, rl.method, rl.confidence, rl.decided_at::text, u.name as decided_by,
      p.id as player_id, p.name as player_name, t.name as team_name,
      oc.id as customer_id, oc.odoo_id as customer_odoo_id, oc.name as customer_name
    from record_links rl
    join players p on p.id = rl.player_id and p.deleted_at is null
    join odoo_customers oc on oc.id = rl.customer_id
    left join teams t on t.id = p.team_id
    left join users u on u.id = rl.decided_by
    where rl.status = 'confirmed'
      ${q ? sql`and (p.name ilike ${likePattern(q)} or oc.name ilike ${likePattern(q)})` : sql``}
    order by p.name`);
}

export async function searchCustomers(q: string, limit = 10) {
  return rows<{ id: number; odoo_id: number; name: string; email: string | null; phone: string | null; reference: string | null; invoice_count: number }>(sql`
    select oc.id, oc.odoo_id, oc.name, oc.email, coalesce(oc.phone, oc.mobile) as phone, oc.reference,
      (select count(*)::int from invoices i where i.customer_id = oc.id and i.deleted_at is null and i.state = 'posted') as invoice_count
    from odoo_customers oc
    where oc.deleted_at is null and (oc.name ilike ${likePattern(q)} or oc.email ilike ${likePattern(q)} or oc.reference = ${q}
      or regexp_replace(coalesce(oc.phone, '') || ' ' || coalesce(oc.mobile, ''), '\\D', '', 'g') like ${`%${q.replace(/\D/g, "") || "__nomatch__"}%`})
    order by invoice_count desc, oc.name
    limit ${limit}`);
}

export async function searchPlayers(q: string, limit = 10) {
  return rows<{ id: number; name: string; external_id: string; team_name: string | null; branch_name: string | null }>(sql`
    select p.id, p.name, p.external_id, t.name as team_name, b.name as branch_name
    from players p left join teams t on t.id = p.team_id left join branches b on b.id = p.branch_id
    where p.deleted_at is null and (p.name ilike ${likePattern(q)} or p.external_id = ${q})
    order by p.name limit ${limit}`);
}

export async function matchingCounts() {
  const [row] = await rows<{ suggestions: number; unmatched_players: number; unmatched_customers: number; confirmed: number }>(sql`
    select
      (select count(distinct rl.player_id)::int from record_links rl join players p on p.id = rl.player_id and p.deleted_at is null
        where rl.status = 'suggested' and not exists (select 1 from record_links c where c.player_id = rl.player_id and c.status = 'confirmed')) as suggestions,
      (select count(*)::int from players p where p.deleted_at is null and not exists (select 1 from record_links rl where rl.player_id = p.id and rl.status = 'confirmed')) as unmatched_players,
      (select count(*)::int from odoo_customers oc where oc.deleted_at is null
        and exists (select 1 from invoices i where i.customer_id = oc.id and i.deleted_at is null and i.state = 'posted')
        and not exists (select 1 from record_links rl where rl.customer_id = oc.id and rl.status = 'confirmed')) as unmatched_customers,
      (select count(*)::int from record_links where status = 'confirmed') as confirmed`);
  return row;
}
