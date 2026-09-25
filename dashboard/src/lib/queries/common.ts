import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { getKv } from "../settings";
import { COMPANY_CURRENCY_KEY } from "../integrations/odoo/sync";

/** Today's date in the academy's timezone (overdue is judged against Beirut time, not UTC). */
export function today(): SQL {
  return sql`(now() at time zone ${env().APP_TIMEZONE})::date`;
}

/** SQL predicate: invoice `alias` is overdue. */
export function overdue(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`(${a}.state = 'posted' and ${a}.move_type = 'out_invoice' and ${a}.amount_residual > 0 and ${a}.due_date < ${today()})`;
}

export function dateRange(column: SQL, from?: string, to?: string): SQL {
  const parts: SQL[] = [];
  if (from) parts.push(sql`${column} >= ${from}`);
  if (to) parts.push(sql`${column} <= ${to}`);
  return parts.length ? sql` and ${sql.join(parts, sql` and `)}` : sql``;
}

export function where(conds: (SQL | null | undefined | false)[]): SQL {
  const list = conds.filter((c): c is SQL => !!c);
  return list.length ? sql`where ${sql.join(list, sql` and `)}` : sql``;
}

export async function rows<T>(query: SQL): Promise<T[]> {
  const res = await db().execute(query);
  return res.rows as T[];
}

export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function orderBy(sort: string | undefined, dir: "asc" | "desc" | undefined, allowed: Record<string, string>, fallback: string): SQL {
  const col = (sort && allowed[sort]) || allowed[fallback];
  const direction = dir === "desc" ? "desc" : dir === "asc" ? "asc" : "asc";
  return sql.raw(`order by ${col} ${direction} nulls last`);
}

export async function companyCurrency(): Promise<string> {
  return (await getKv<string>(COMPANY_CURRENCY_KEY)) ?? "USD";
}
