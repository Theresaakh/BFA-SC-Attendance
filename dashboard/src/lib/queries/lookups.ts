import { sql } from "drizzle-orm";
import { rows } from "./common";

export type Option = { id: number; name: string; branch_id?: number | null };

/** Options for the filter drop-downs. */
export async function lookups() {
  const [branches, teams, coaches] = await Promise.all([
    rows<Option>(sql`select id, name from branches where deleted_at is null order by name`),
    rows<Option>(sql`select t.id, t.name || coalesce(' · ' || b.name, '') as name, t.branch_id from teams t left join branches b on b.id = t.branch_id where t.deleted_at is null order by b.name nulls last, t.name`),
    rows<Option>(sql`select id, name from coaches where deleted_at is null order by name`),
  ]);
  return { branches, teams, coaches };
}

export type Lookups = Awaited<ReturnType<typeof lookups>>;
