import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runSync } from "@/lib/sync/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * For external schedulers (system cron, Vercel Cron, GitHub Actions…):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/sync
 * Disabled unless CRON_SECRET is set.
 */
async function handle(req: Request) {
  if (!authorised(req)) return Response.json({ error: "Unauthorised." }, { status: 401 });
  const outcome = await runSync({ trigger: "cron" });
  if (!outcome.started) return Response.json({ skipped: true, reason: outcome.reason }, { status: 409 });
  return Response.json({ runs: outcome.runs });
}

export const POST = handle;
export const GET = handle;
