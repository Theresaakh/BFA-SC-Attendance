import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";

export async function listSyncRuns(page = 1, pageSize = 30) {
  const d = db();
  const runs = await d
    .select({
      run: schema.syncRuns,
      userName: schema.users.name,
    })
    .from(schema.syncRuns)
    .leftJoin(schema.users, eq(schema.users.id, schema.syncRuns.triggeredBy))
    .orderBy(desc(schema.syncRuns.startedAt), desc(schema.syncRuns.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(schema.syncRuns);
  return { runs, total: n };
}

export async function syncRunDetail(id: number) {
  const d = db();
  const [run] = await d.select().from(schema.syncRuns).where(eq(schema.syncRuns.id, id)).limit(1);
  if (!run) return null;
  const errors = await d.select().from(schema.syncErrors).where(eq(schema.syncErrors.runId, id)).orderBy(schema.syncErrors.id).limit(500);
  return { run, errors };
}
