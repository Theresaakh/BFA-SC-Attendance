import { desc, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { getSettings } from "../settings";
import { runSync } from "./runner";

const TICK_MS = 60_000;
const holder = globalThis as unknown as { __bfaScheduler?: NodeJS.Timeout };

/**
 * In-process scheduler. Every minute it checks whether the configured interval
 * (Settings → Sync frequency, stored in the database) has elapsed since the last scheduled
 * or manual run, and starts a sync if so. Changing the frequency takes effect immediately.
 * The advisory lock in runSync makes it safe to run on several instances; for serverless
 * hosting, disable it (SYNC_SCHEDULER_ENABLED=false) and call /api/cron/sync instead.
 */
export function startScheduler() {
  if (holder.__bfaScheduler || env().SYNC_SCHEDULER_ENABLED !== "true") return;
  const tick = async () => {
    try {
      const { syncIntervalMinutes } = await getSettings();
      if (syncIntervalMinutes <= 0) return;
      const [last] = await db()
        .select({ startedAt: schema.syncRuns.startedAt })
        .from(schema.syncRuns)
        .where(inArray(schema.syncRuns.source, ["odoo", "bfa"]))
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(1);
      if (last && Date.now() - last.startedAt.getTime() < syncIntervalMinutes * 60_000) return;
      const outcome = await runSync({ trigger: "scheduled" });
      if (outcome.started) {
        console.log(`[scheduler] sync finished: ${outcome.runs.map((r) => `${r.source}=${r.status}`).join(", ")}`);
      }
    } catch (err) {
      console.error("[scheduler] tick failed:", err instanceof Error ? err.message : err);
    }
  };
  holder.__bfaScheduler = setInterval(tick, TICK_MS);
  holder.__bfaScheduler.unref?.();
  setTimeout(tick, 15_000).unref?.();
  console.log("[scheduler] started");
}
