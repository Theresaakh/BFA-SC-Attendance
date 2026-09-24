import { env } from "./env";
import { bootstrapInitialAdmin } from "./auth/users";
import { startScheduler } from "./sync/scheduler";

/** Runs once when the server starts (see src/instrumentation.ts). */
export async function bootstrap() {
  // Skip during `next build`, which also loads instrumentation.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const e = env();
    const created = await bootstrapInitialAdmin({ email: e.INITIAL_ADMIN_EMAIL, password: e.INITIAL_ADMIN_PASSWORD, name: e.INITIAL_ADMIN_NAME });
    if (created) console.log(`[bootstrap] created initial administrator ${e.INITIAL_ADMIN_EMAIL}`);
    startScheduler();
  } catch (err) {
    console.error("[bootstrap] failed:", err instanceof Error ? err.message : err);
  }
}
