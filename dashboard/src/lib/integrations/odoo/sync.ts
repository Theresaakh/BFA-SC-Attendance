import { and, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../../db";
import { upsertChanged } from "../../db/upsert";
import { odooConfig } from "../../env";
import { getKv, setKv } from "../../settings";
import { normalizeName } from "../../matching/normalize";
import type { SyncReporter } from "../../sync/reporter";
import { IntegrationError } from "../errors";
import {
  OdooClient,
  m2oId,
  m2oName,
  odooDate,
  odooDateTime,
  odooStr,
  toOdooDateTime,
  type OdooDomain,
} from "./client";

const CURSOR_KEY = "odoo.cursor";
export const COMPANY_CURRENCY_KEY = "odoo.companyCurrency";
export const SERVER_INFO_KEY = "odoo.serverInfo";
/** Re-read records modified shortly before the last cursor to cover clock skew and in-flight transactions. */
const CURSOR_OVERLAP_MS = 10 * 60 * 1000;

type OdooInvoice = Record<string, unknown> & { id: number };
type OdooPayment = Record<string, unknown> & { id: number };
type OdooPartner = Record<string, unknown> & { id: number };

export async function syncOdoo(report: SyncReporter, opts: { full?: boolean; client?: OdooClient } = {}) {
  const cfg = odooConfig();
  if (!cfg.configured && !opts.client) {
    throw new IntegrationError("Odoo", "not_configured", `Odoo is not configured. Set ${cfg.missing.join(", ")} in the server environment.`);
  }
  const client = opts.client ?? new OdooClient(cfg);
  const info = await client.connect();
  await setKv(SERVER_INFO_KEY, { ...info, checkedAt: new Date().toISOString() });
  report.note(`Connected to Odoo ${info.serverVersion} via ${info.protocol === "json2" ? "JSON-2 API" : "JSON-RPC"}.`);

  const [moveFields, partnerFields] = await Promise.all([client.fieldNames("account.move"), client.fieldNames("res.partner")]);
  const has = (set: Set<string>, f: string) => set.has(f);

  // ---- Company currency ---------------------------------------------------------------
  try {
    const companies = await client.searchRead<{ id: number; currency_id: unknown }>(
      "res.company",
      cfg.companyId ? [["id", "=", cfg.companyId]] : [],
      ["currency_id"],
      { limit: 1 },
    );
    const currency = m2oName(companies[0]?.currency_id);
    if (currency) await setKv(COMPANY_CURRENCY_KEY, currency);
  } catch (err) {
    report.error("res.company", null, err);
  }

  // ---- Invoices -----------------------------------------------------------------------
  const baseDomain: OdooDomain = [["move_type", "in", ["out_invoice", "out_refund"]]];
  if (cfg.companyId) baseDomain.push(["company_id", "=", cfg.companyId]);
  if (cfg.invoiceStartDate) baseDomain.push("|", ["invoice_date", "=", false], ["invoice_date", ">=", cfg.invoiceStartDate]);

  const cursor = opts.full ? null : await getKv<string>(CURSOR_KEY);
  const since = cursor ? toOdooDateTime(new Date(new Date(cursor).getTime() - CURSOR_OVERLAP_MS)) : null;

  const invoiceFieldList = [
    "name", "move_type", "state", "payment_state", "invoice_date", "invoice_date_due", "partner_id",
    "currency_id", "amount_untaxed", "amount_total", "amount_residual", "amount_total_signed",
    "amount_residual_signed", "ref", "invoice_origin", "write_date",
  ].filter((f) => has(moveFields, f));

  const changedInvoices = await client.searchReadAll<OdooInvoice>(
    "account.move",
    since ? [...baseDomain, ["write_date", ">=", since]] : baseDomain,
    invoiceFieldList,
  );

  // Invoices that are still open locally are always refreshed, so payment status can never go stale.
  const openLocal = await db()
    .select({ odooId: schema.invoices.odooId })
    .from(schema.invoices)
    .where(and(isNull(schema.invoices.deletedAt), inArray(schema.invoices.paymentState, ["not_paid", "partial", "in_payment"])));
  const seen = new Set(changedInvoices.map((i) => i.id));
  const toRefresh = openLocal.map((r) => r.odooId).filter((id) => !seen.has(id));
  const refreshed: OdooInvoice[] = [];
  for (let i = 0; i < toRefresh.length; i += 500) {
    refreshed.push(
      ...(await client.searchRead<OdooInvoice>("account.move", [["id", "in", toRefresh.slice(i, i + 500)]], invoiceFieldList)),
    );
  }
  const allInvoices = [...changedInvoices, ...refreshed];

  // ---- Payments -----------------------------------------------------------------------
  let paymentsFetched: OdooPayment[] = [];
  let paymentsOk = true;
  try {
    const paymentFields = await client.fieldNames("account.payment");
    const pf = ["name", "date", "amount", "currency_id", "state", "payment_type", "partner_id", "reconciled_invoice_ids", "memo", "ref", "write_date"]
      .filter((f) => paymentFields.has(f));
    const pDomain: OdooDomain = [["partner_type", "=", "customer"]];
    if (cfg.companyId) pDomain.push(["company_id", "=", cfg.companyId]);
    paymentsFetched = await client.searchReadAll<OdooPayment>("account.payment", since ? [...pDomain, ["write_date", ">=", since]] : pDomain, pf);
  } catch (err) {
    paymentsOk = false;
    report.error("account.payment", null, err, { hint: "Payments could not be read; invoice payment status is still synchronised." });
  }

  // ---- Customers ----------------------------------------------------------------------
  const partnerIds = new Set<number>();
  for (const inv of allInvoices) {
    const pid = m2oId(inv.partner_id);
    if (pid) partnerIds.add(pid);
  }
  for (const p of paymentsFetched) {
    const pid = m2oId(p.partner_id);
    if (pid) partnerIds.add(pid);
  }
  const partnerFieldList = ["name", "email", "phone", "mobile", "parent_id", "is_company", "active", "write_date", cfg.playerIdField]
    .filter((f, i, arr) => has(partnerFields, f) && arr.indexOf(f) === i);
  if (!has(partnerFields, cfg.playerIdField)) {
    report.note(`Odoo contacts have no field "${cfg.playerIdField}" (ODOO_PLAYER_ID_FIELD); matching by player ID is disabled.`);
  }
  // Also refresh contact details of customers we already know, when they changed in Odoo.
  const knownChanged: number[] = [];
  if (since) {
    const known = await db().select({ odooId: schema.odooCustomers.odooId }).from(schema.odooCustomers);
    const knownIds = known.map((k) => k.odooId).filter((id) => !partnerIds.has(id));
    for (let i = 0; i < knownIds.length; i += 1000) {
      knownChanged.push(
        ...(await client.searchIds("res.partner", [["id", "in", knownIds.slice(i, i + 1000)], ["write_date", ">=", since]], { active_test: false })),
      );
    }
  }
  const partnerIdList = [...partnerIds, ...knownChanged];
  const partners: OdooPartner[] = [];
  for (let i = 0; i < partnerIdList.length; i += 500) {
    partners.push(
      ...(await client.searchRead<OdooPartner>("res.partner", [["id", "in", partnerIdList.slice(i, i + 500)]], partnerFieldList, {
        context: { active_test: false },
      })),
    );
  }

  const customerRows = partners.map((p) => ({
    odooId: p.id,
    name: odooStr(p.name) ?? `Odoo contact #${p.id}`,
    normalizedName: normalizeName(odooStr(p.name)),
    email: odooStr(p.email),
    phone: odooStr(p.phone),
    mobile: odooStr(p.mobile),
    reference: odooStr(p[cfg.playerIdField]),
    parentOdooId: m2oId(p.parent_id),
    parentName: m2oName(p.parent_id),
    isCompany: p.is_company === true,
    active: p.active !== false,
    odooWriteDate: odooDateTime(p.write_date),
    deletedAt: null,
  }));
  const customerRes = await upsertChanged(db(), schema.odooCustomers, customerRows, {
    target: schema.odooCustomers.odooId,
    compare: ["name", "normalizedName", "email", "phone", "mobile", "reference", "parentOdooId", "parentName", "isCompany", "active", "deletedAt"],
  });
  report.merge({ processed: customerRows.length, added: customerRes.added, updated: customerRes.updated, skipped: customerRes.unchanged });

  const customerIdByOdoo = new Map<number, number>();
  const neededPartnerIds = [...partnerIds];
  for (let i = 0; i < neededPartnerIds.length; i += 1000) {
    const rows = await db()
      .select({ id: schema.odooCustomers.id, odooId: schema.odooCustomers.odooId })
      .from(schema.odooCustomers)
      .where(inArray(schema.odooCustomers.odooId, neededPartnerIds.slice(i, i + 1000)));
    rows.forEach((r) => customerIdByOdoo.set(r.odooId, r.id));
  }

  // ---- Upsert invoices ----------------------------------------------------------------
  const invoiceRows: (typeof schema.invoices.$inferInsert)[] = [];
  for (const inv of allInvoices) {
    try {
      const moveType = odooStr(inv.move_type) ?? "out_invoice";
      const sign = moveType === "out_refund" ? -1 : 1;
      const total = Number(inv.amount_total ?? 0);
      const residual = Number(inv.amount_residual ?? 0);
      const partnerOdooId = m2oId(inv.partner_id);
      if (partnerOdooId && !customerIdByOdoo.has(partnerOdooId)) {
        report.error("account.move", inv.id, new Error(`Customer #${partnerOdooId} of invoice ${odooStr(inv.name)} could not be loaded.`));
      }
      invoiceRows.push({
        odooId: inv.id,
        number: odooStr(inv.name) ?? `Draft #${inv.id}`,
        customerId: partnerOdooId ? (customerIdByOdoo.get(partnerOdooId) ?? null) : null,
        moveType,
        state: odooStr(inv.state) ?? "draft",
        paymentState: odooStr(inv.payment_state) ?? "not_paid",
        invoiceDate: odooDate(inv.invoice_date),
        dueDate: odooDate(inv.invoice_date_due) ?? odooDate(inv.invoice_date),
        currency: m2oName(inv.currency_id),
        amountUntaxed: Number(inv.amount_untaxed ?? 0),
        amountTotal: total,
        amountResidual: residual,
        amountTotalSigned: inv.amount_total_signed !== undefined ? Number(inv.amount_total_signed) : sign * total,
        amountResidualSigned: inv.amount_residual_signed !== undefined ? Number(inv.amount_residual_signed) : sign * residual,
        reference: odooStr(inv.ref),
        origin: odooStr(inv.invoice_origin),
        odooWriteDate: odooDateTime(inv.write_date),
        deletedAt: null,
      });
    } catch (err) {
      report.skipped++;
      report.error("account.move", inv.id, err);
    }
  }
  const invRes = await upsertChanged(db(), schema.invoices, invoiceRows, {
    target: schema.invoices.odooId,
    compare: [
      "number", "customerId", "moveType", "state", "paymentState", "invoiceDate", "dueDate", "currency", "amountUntaxed",
      "amountTotal", "amountResidual", "amountTotalSigned", "amountResidualSigned", "reference", "origin", "deletedAt",
    ],
  });
  report.merge({ processed: invoiceRows.length, added: invRes.added, updated: invRes.updated, skipped: invRes.unchanged });

  // ---- Upsert payments ----------------------------------------------------------------
  if (paymentsFetched.length) {
    const paymentRows = paymentsFetched.map((p) => ({
      odooId: p.id,
      name: odooStr(p.name),
      customerId: m2oId(p.partner_id) ? (customerIdByOdoo.get(m2oId(p.partner_id)!) ?? null) : null,
      date: odooDate(p.date),
      amount: Number(p.amount ?? 0),
      currency: m2oName(p.currency_id),
      state: odooStr(p.state),
      paymentType: odooStr(p.payment_type),
      memo: odooStr(p.memo) ?? odooStr(p.ref),
      odooWriteDate: odooDateTime(p.write_date),
      deletedAt: null,
    }));
    const payRes = await upsertChanged(db(), schema.payments, paymentRows, {
      target: schema.payments.odooId,
      compare: ["name", "customerId", "date", "amount", "currency", "state", "paymentType", "memo", "deletedAt"],
    });
    report.merge({ processed: paymentRows.length, added: payRes.added, updated: payRes.updated, skipped: payRes.unchanged });

    // Payment ↔ invoice allocation.
    const payIds = await db()
      .select({ id: schema.payments.id, odooId: schema.payments.odooId })
      .from(schema.payments)
      .where(inArray(schema.payments.odooId, paymentRows.map((r) => r.odooId)));
    const payIdByOdoo = new Map(payIds.map((r) => [r.odooId, r.id]));
    const invOdooIds = [...new Set(paymentsFetched.flatMap((p) => (Array.isArray(p.reconciled_invoice_ids) ? (p.reconciled_invoice_ids as number[]) : [])))];
    const invIdByOdoo = new Map<number, number>();
    for (let i = 0; i < invOdooIds.length; i += 1000) {
      const rows = await db()
        .select({ id: schema.invoices.id, odooId: schema.invoices.odooId })
        .from(schema.invoices)
        .where(inArray(schema.invoices.odooId, invOdooIds.slice(i, i + 1000)));
      rows.forEach((r) => invIdByOdoo.set(r.odooId, r.id));
    }
    await db().transaction(async (tx) => {
      const localPayIds = [...payIdByOdoo.values()];
      if (localPayIds.length) await tx.delete(schema.paymentInvoices).where(inArray(schema.paymentInvoices.paymentId, localPayIds));
      const links = paymentsFetched.flatMap((p) =>
        (Array.isArray(p.reconciled_invoice_ids) ? (p.reconciled_invoice_ids as number[]) : [])
          .filter((iid) => invIdByOdoo.has(iid) && payIdByOdoo.has(p.id))
          .map((iid) => ({ paymentId: payIdByOdoo.get(p.id)!, invoiceId: invIdByOdoo.get(iid)! })),
      );
      for (let i = 0; i < links.length; i += 1000) {
        await tx.insert(schema.paymentInvoices).values(links.slice(i, i + 1000)).onConflictDoNothing();
      }
    });
  }

  // ---- Deleted records ----------------------------------------------------------------
  // Posted invoices cannot be deleted in Odoo, but drafts can; mirror deletions as soft-deletes.
  const liveInvoiceIds = await client.searchIds("account.move", baseDomain);
  report.deleted += await softDeleteMissing("invoices", liveInvoiceIds);
  if (paymentsOk) {
    const pDomain: OdooDomain = [["partner_type", "=", "customer"]];
    if (cfg.companyId) pDomain.push(["company_id", "=", cfg.companyId]);
    const livePaymentIds = await client.searchIds("account.payment", pDomain);
    report.deleted += await softDeleteMissing("payments", livePaymentIds);
  }

  // ---- Advance cursor -----------------------------------------------------------------
  const maxWrite = [...changedInvoices, ...paymentsFetched, ...partners]
    .map((r) => odooDateTime(r.write_date))
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);
  if (maxWrite) await setKv(CURSOR_KEY, maxWrite.toISOString());
  else if (!cursor) await setKv(CURSOR_KEY, new Date().toISOString());
}

async function softDeleteMissing(table: "invoices" | "payments", liveOdooIds: number[]): Promise<number> {
  const t = table === "invoices" ? schema.invoices : schema.payments;
  const live = new Set(liveOdooIds);
  const local = await db().select({ id: t.id, odooId: t.odooId }).from(t).where(isNull(t.deletedAt));
  const missing = local.filter((r) => !live.has(r.odooId)).map((r) => r.id);
  for (let i = 0; i < missing.length; i += 1000) {
    await db().update(t).set({ deletedAt: new Date() }).where(inArray(t.id, missing.slice(i, i + 1000)));
  }
  return missing.length;
}

export async function resetOdooCursor() {
  await setKv(CURSOR_KEY, null);
}

/** Used by the Settings page "Test connection" button. */
export async function testOdooConnection() {
  const cfg = odooConfig();
  if (!cfg.configured) {
    throw new IntegrationError("Odoo", "not_configured", `Missing: ${cfg.missing.join(", ")}`);
  }
  const client = new OdooClient(cfg);
  const info = await client.connect();
  const ids = await client.searchIds("account.move", [["move_type", "=", "out_invoice"], ["state", "=", "posted"]]);
  return { ...info, postedInvoices: ids.length };
}
