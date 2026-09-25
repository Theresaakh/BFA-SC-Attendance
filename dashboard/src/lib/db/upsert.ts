import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DB } from "./index";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Batched INSERT … ON CONFLICT DO UPDATE that only rewrites rows whose content actually
 * changed, and reports how many rows were added, updated or left untouched.
 */
export async function upsertChanged<T extends PgTable>(
  tx: Tx | DB,
  table: T,
  rows: T["$inferInsert"][],
  opts: { target: PgColumn; compare: string[]; batchSize?: number },
): Promise<{ added: number; updated: number; unchanged: number; ids: Map<string, number> }> {
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const result = { added: 0, updated: 0, unchanged: 0, ids: new Map<string, number>() };
  if (!rows.length) return result;
  const batchSize = opts.batchSize ?? 500;
  const targetKey = Object.entries(columns).find(([, c]) => c === opts.target)?.[0];
  if (!targetKey) throw new Error("upsertChanged: target column not found on table");

  const set: Record<string, SQL> = {};
  const current: SQL[] = [];
  const incoming: SQL[] = [];
  for (const key of opts.compare) {
    const col = columns[key];
    if (!col) throw new Error(`upsertChanged: unknown column ${key}`);
    set[key] = sql.raw(`excluded."${col.name}"`);
    current.push(sql`${col}`);
    incoming.push(sql.raw(`excluded."${col.name}"`));
  }
  if (columns.updatedAt) set.updatedAt = sql`now()`;
  const changed = sql`(${sql.join(current, sql`, `)}) is distinct from (${sql.join(incoming, sql`, `)})`;
  const idCol = columns.id;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const returned = (await tx
      .insert(table)
      .values(batch)
      .onConflictDoUpdate({ target: opts.target, set, setWhere: changed })
      .returning({ id: idCol, key: opts.target, inserted: sql<boolean>`(xmax = 0)` })) as {
      id: number;
      key: unknown;
      inserted: boolean;
    }[];
    for (const r of returned) {
      if (r.inserted) result.added++;
      else result.updated++;
      result.ids.set(String(r.key), r.id);
    }
    result.unchanged += batch.length - returned.length;
  }
  return result;
}

export type { Tx };
