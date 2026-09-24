/**
 * Run a synchronisation from the command line (e.g. from a system cron job):
 *   npm run sync                 # both systems
 *   npm run sync -- --only odoo  # or: --only bfa
 *   npm run sync -- --full       # ignore the Odoo change cursor and re-read everything
 */
import { parseArgs } from "node:util";
import { runSync } from "../src/lib/sync/runner";
import { closeDb } from "../src/lib/db";

async function main() {
  const { values } = parseArgs({ options: { only: { type: "string" }, full: { type: "boolean", default: false } } });
  if (values.only && values.only !== "odoo" && values.only !== "bfa") throw new Error("--only must be odoo or bfa");
  const outcome = await runSync({ trigger: "cli", sources: values.only ? [values.only as "odoo" | "bfa"] : undefined, full: values.full });
  if (!outcome.started) {
    console.log(outcome.reason);
    return;
  }
  for (const r of outcome.runs) console.log(`${r.source.padEnd(9)} ${r.status.padEnd(8)} ${r.message ?? ""}`);
  if (outcome.runs.some((r) => r.status === "failed")) process.exitCode = 2;
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(closeDb);
