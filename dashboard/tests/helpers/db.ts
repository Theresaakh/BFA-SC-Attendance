import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

let migrated = false;

export async function resetDatabase() {
  if (!migrated) {
    await migrate(db(), { migrationsFolder: "./drizzle" });
    migrated = true;
  }
  await db().execute(sql`
    truncate table sync_errors, sync_runs, record_links, payment_invoices, payments, invoices, odoo_customers,
      coach_attendance_records, attendance_records, attendance_sessions, players, team_coaches, coaches, teams, branches,
      sessions, users, app_settings restart identity cascade`);
}
