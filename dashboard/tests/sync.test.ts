import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { syncBfa } from "@/lib/integrations/bfa/sync";
import { syncOdoo } from "@/lib/integrations/odoo/sync";
import { OdooClient } from "@/lib/integrations/odoo/client";
import { IntegrationError } from "@/lib/integrations/errors";
import { runMatching } from "@/lib/matching/engine";
import { SyncReporter } from "@/lib/sync/reporter";
import { runSync } from "@/lib/sync/runner";
import { resetDatabase } from "./helpers/db";
import { fakeOdoo } from "./helpers/fake-odoo";
import { bfaRaw, inv, odooData } from "./helpers/fixtures";

const odooClient = (fetchImpl: typeof fetch, apiKey = "secret-key") =>
  new OdooClient({ url: "https://odoo.test", db: "bfa", login: "admin@bfa.test", apiKey, protocol: "auto", timeoutMs: 5000, fetchImpl });

beforeEach(resetDatabase);

describe("BFA attendance sync", () => {
  it("imports branches, teams, coaches, players, sessions and attendance", async () => {
    const r = new SyncReporter();
    await syncBfa(r, { raw: bfaRaw() });
    const d = db();
    expect(await d.$count(schema.branches)).toBe(2);
    expect(await d.$count(schema.teams)).toBe(2);
    expect(await d.$count(schema.coaches)).toBe(3); // Karim, Rami, Maya
    expect(await d.$count(schema.players)).toBe(4);
    expect(await d.$count(schema.attendanceSessions)).toBe(6); // t1 and t2 each on 09-01, 09-03, 09-05
    expect(await d.$count(schema.attendanceRecords)).toBe(10);
    expect(await d.$count(schema.coachAttendanceRecords)).toBe(4);
    const [team] = await d.select().from(schema.teams).where(eq(schema.teams.externalId, "t1"));
    expect(team.category).toBe("U14");
    // The unknown "ghost" player is logged, not silently dropped.
    expect(r.errors.some((e) => e.message.includes("no longer exists"))).toBe(true);
  });

  it("is idempotent and mirrors changes and deletions", async () => {
    await syncBfa(new SyncReporter(), { raw: bfaRaw() });
    const again = new SyncReporter();
    await syncBfa(again, { raw: bfaRaw() });
    expect(again.added).toBe(0);
    expect(again.updated).toBe(0);
    expect(await db().$count(schema.attendanceRecords)).toBe(10);

    const raw = bfaRaw();
    raw.attendance["2026-09-01"].p2 = "present"; // changed
    delete (raw.players as Record<string, unknown>).p4; // player removed
    delete (raw.attendance as Record<string, unknown>)["2026-09-05"]; // session removed
    const changed = new SyncReporter();
    await syncBfa(changed, { raw });
    expect(changed.updated).toBeGreaterThanOrEqual(1);
    expect(changed.deleted).toBeGreaterThanOrEqual(1);
    const [p4] = await db().select().from(schema.players).where(eq(schema.players.externalId, "p4"));
    expect(p4.deletedAt).not.toBeNull();
    const liveSessions = await db().select().from(schema.attendanceSessions).where(and(isNull(schema.attendanceSessions.deletedAt), eq(schema.attendanceSessions.date, "2026-09-05")));
    expect(liveSessions).toHaveLength(0);
  });

  it("rejects an empty or wrong data root", async () => {
    await expect(syncBfa(new SyncReporter(), { raw: {} })).rejects.toBeInstanceOf(IntegrationError);
  });
});

describe("Odoo sync", () => {
  it("imports customers, invoices and payments, then updates incrementally", async () => {
    const data = odooData();
    const odoo = fakeOdoo(data);
    const r = new SyncReporter();
    await syncOdoo(r, { client: odooClient(odoo.fetchImpl) });
    expect(r.errors).toEqual([]);
    expect(await db().$count(schema.invoices)).toBe(5);
    expect(await db().$count(schema.payments)).toBe(2);
    expect(await db().$count(schema.odooCustomers)).toBe(4);
    expect(await db().$count(schema.paymentInvoices)).toBe(2);

    // Invoice 102 gets paid and a new invoice appears; a draft invoice is deleted in Odoo.
    data["account.move"][2] = { ...data["account.move"][2], payment_state: "paid", amount_residual: 0, amount_residual_signed: 0 };
    data["account.move"].push(inv(105, "INV/2026/0006", 10, "not_paid", 80, 80, "2026-09-20", "2026-10-05"));
    data["account.move"] = data["account.move"].filter((m) => m.id !== 104);
    const r2 = new SyncReporter();
    await syncOdoo(r2, { client: odooClient(odoo.fetchImpl) });
    const [paid] = await db().select().from(schema.invoices).where(eq(schema.invoices.odooId, 102));
    expect(paid.paymentState).toBe("paid");
    expect(paid.amountResidual).toBe(0);
    expect(r2.added).toBeGreaterThanOrEqual(1);
    const [gone] = await db().select().from(schema.invoices).where(eq(schema.invoices.odooId, 104));
    expect(gone.deletedAt).not.toBeNull();
    expect(r2.deleted).toBe(1);
  });

  it("reports invalid credentials clearly", async () => {
    const odoo = fakeOdoo(odooData());
    await expect(syncOdoo(new SyncReporter(), { client: odooClient(odoo.fetchImpl, "wrong") })).rejects.toMatchObject({ kind: "auth" });
  });

  it("continues when payments are not readable", async () => {
    const odoo = fakeOdoo(odooData(), { failModels: ["account.payment"] });
    const r = new SyncReporter();
    await syncOdoo(r, { client: odooClient(odoo.fetchImpl) });
    expect(await db().$count(schema.invoices)).toBe(5);
    expect(r.errors[0].message).toMatch(/not allowed/);
  });

  it("reports timeouts and unreachable servers", async () => {
    const hanging = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))))) as typeof fetch;
    const c = new OdooClient({ url: "https://odoo.test", db: "bfa", login: "x", apiKey: "y", protocol: "jsonrpc", timeoutMs: 1000, fetchImpl: hanging });
    await expect(c.connect()).rejects.toMatchObject({ kind: "timeout" });
    const down = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); }) as typeof fetch;
    const c2 = new OdooClient({ url: "https://odoo.test", db: "bfa", login: "x", apiKey: "y", protocol: "jsonrpc", timeoutMs: 1000, fetchImpl: down });
    await expect(c2.connect()).rejects.toMatchObject({ kind: "network" });
  }, 20000);
});

describe("matching after sync", () => {
  it("links certain matches and leaves uncertain ones for review", async () => {
    await syncBfa(new SyncReporter(), { raw: bfaRaw() });
    await syncOdoo(new SyncReporter(), { client: odooClient(fakeOdoo(odooData()).fetchImpl) });
    await runMatching(new SyncReporter());
    const links = await db()
      .select({ player: schema.players.externalId, customer: schema.odooCustomers.odooId, status: schema.recordLinks.status, method: schema.recordLinks.method })
      .from(schema.recordLinks)
      .innerJoin(schema.players, eq(schema.players.id, schema.recordLinks.playerId))
      .innerJoin(schema.odooCustomers, eq(schema.odooCustomers.id, schema.recordLinks.customerId));
    const byPlayer = Object.fromEntries(links.map((l) => [l.player, l]));
    expect(byPlayer.p1).toMatchObject({ customer: 10, status: "confirmed", method: "name_exact" });
    expect(byPlayer.p3).toMatchObject({ customer: 12, status: "confirmed", method: "player_id" });
    expect(byPlayer.p2).toMatchObject({ customer: 11, status: "suggested", method: "name_fuzzy" });
    expect(byPlayer.p4).toBeUndefined();
  });
});

describe("sync runner", () => {
  it("logs a clear failure when an integration is not configured", async () => {
    delete process.env.ODOO_URL;
    const out = await runSync({ sources: ["odoo"], trigger: "manual" });
    expect(out.started).toBe(true);
    expect(out.runs[0]).toMatchObject({ source: "odoo", status: "failed" });
    expect(out.runs[0].message).toMatch(/not configured/);
    const errors = await db().select().from(schema.syncErrors);
    expect(errors).toHaveLength(1);
  });
});
