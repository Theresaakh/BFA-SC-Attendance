import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, pool, schema } from "../db";
import { IntegrationError, errorMessage } from "../integrations/errors";
import { syncOdoo } from "../integrations/odoo/sync";
import { syncBfa } from "../integrations/bfa/sync";
import { runMatching } from "../matching/engine";
import { SyncReporter } from "./reporter";

export type SyncSource = "odoo" | "bfa";
export type SyncTrigger = "manual" | "scheduled" | "cron" | "cli";

export type SyncOutcome = {
  started: boolean;
  reason?: string;
  runs: { source: "odoo" | "bfa" | "matching"; runId: number; status: "success" | "partial" | "failed"; message: string | null }[];
};

/** Arbitrary constant identifying the sync lock among PostgreSQL advisory locks. */
const SYNC_LOCK_KEY = 72_001_937;
const MAX_ERRORS_LOGGED = 500;

/**
 * Runs a synchronisation. A PostgreSQL advisory lock guarantees that only one sync runs at a
 * time, even with several app instances (manual button, scheduler and external cron).
 */
export async function runSync(opts: {
  sources?: SyncSource[];
  trigger: SyncTrigger;
  userId?: number | null;
  full?: boolean;
}): Promise<SyncOutcome> {
  const sources = opts.sources ?? ["bfa", "odoo"];
  const client = await pool().connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [SYNC_LOCK_KEY]);
    if (!rows[0]?.locked) return { started: false, reason: "A synchronisation is already running.", runs: [] };
    try {
      // Anything still "running" while we hold the lock was interrupted (e.g. a server restart).
      await db()
        .update(schema.syncRuns)
        .set({ status: "failed", finishedAt: new Date(), message: "Interrupted before completion (server restart or crash)." })
        .where(eq(schema.syncRuns.status, "running"));

      const runs: SyncOutcome["runs"] = [];
      let anySucceeded = false;
      for (const source of sources) {
        const run = await executeRun(source, opts.trigger, opts.userId ?? null, (r) =>
          source === "odoo" ? syncOdoo(r, { full: opts.full }) : syncBfa(r),
        );
        runs.push(run);
        if (run.status !== "failed") anySucceeded = true;
      }
      if (anySucceeded) runs.push(await executeRun("matching", opts.trigger, opts.userId ?? null, runMatching));
      return { started: true, runs };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [SYNC_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function executeRun(
  source: "odoo" | "bfa" | "matching",
  trigger: SyncTrigger,
  userId: number | null,
  fn: (r: SyncReporter) => Promise<void>,
): Promise<SyncOutcome["runs"][number]> {
  const [run] = await db()
    .insert(schema.syncRuns)
    .values({ source, trigger, triggeredBy: userId, status: "running" })
    .returning({ id: schema.syncRuns.id });
  const report = new SyncReporter();
  let status: "success" | "partial" | "failed" = "success";
  let message: string | null = null;
  try {
    await fn(report);
    if (report.errors.length) status = "partial";
    message = [...report.notes, report.errors.length ? `${report.errors.length} problem(s) were logged.` : null].filter(Boolean).join(" ") || null;
  } catch (err) {
    status = "failed";
    message = err instanceof IntegrationError ? err.message : `Unexpected error: ${errorMessage(err)}`;
    if (!(err instanceof IntegrationError)) console.error(`[sync:${source}]`, err);
    report.error(null, null, err, err instanceof IntegrationError ? { system: err.system } : undefined);
  }

  const errors = report.errors.slice(0, MAX_ERRORS_LOGGED);
  if (errors.length) {
    await db()
      .insert(schema.syncErrors)
      .values(errors.map((e) => ({ runId: run.id, entityType: e.entityType, externalId: e.externalId, message: e.message.slice(0, 2000), details: e.details ?? null })));
  }
  await db()
    .update(schema.syncRuns)
    .set({
      status,
      finishedAt: new Date(),
      processed: report.processed,
      added: report.added,
      updated: report.updated,
      skipped: report.skipped,
      deleted: report.deleted,
      errorCount: report.errors.length,
      message: message?.slice(0, 2000) ?? null,
    })
    .where(eq(schema.syncRuns.id, run.id));
  return { source, runId: run.id, status, message };
}

export type SourceStatus = {
  source: "odoo" | "bfa";
  lastRun: typeof schema.syncRuns.$inferSelect | null;
  lastSuccessAt: Date | null;
};

export async function getSyncOverview(): Promise<{ running: boolean; sources: SourceStatus[]; lastSuccessAt: Date | null }> {
  const d = db();
  const sources: SourceStatus[] = [];
  for (const source of ["odoo", "bfa"] as const) {
    const [lastRun] = await d.select().from(schema.syncRuns).where(eq(schema.syncRuns.source, source)).orderBy(desc(schema.syncRuns.startedAt)).limit(1);
    const [lastOk] = await d
      .select({ at: schema.syncRuns.finishedAt })
      .from(schema.syncRuns)
      .where(and(eq(schema.syncRuns.source, source), inArray(schema.syncRuns.status, ["success", "partial"])))
      .orderBy(desc(schema.syncRuns.finishedAt))
      .limit(1);
    sources.push({ source, lastRun: lastRun ?? null, lastSuccessAt: lastOk?.at ?? null });
  }
  const [running] = await d.select({ n: sql<number>`count(*)::int` }).from(schema.syncRuns).where(eq(schema.syncRuns.status, "running"));
  const okTimes = sources.map((s) => s.lastSuccessAt).filter((x): x is Date => !!x);
  return {
    running: running.n > 0,
    sources,
    lastSuccessAt: okTimes.length ? new Date(Math.min(...okTimes.map((t) => t.getTime()))) : null,
  };
}
