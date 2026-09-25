import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { getSettings } from "../settings";
import type { SyncReporter } from "../sync/reporter";
import { nameSimilarity, normalizeEmail, normalizePhone } from "./normalize";

export type MatchPlayer = { id: number; externalId: string; name: string; normalizedName: string; email: string | null; phone: string | null };
export type MatchCustomer = {
  id: number;
  name: string;
  normalizedName: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  reference: string | null;
};

export type Candidate = {
  playerId: number;
  customerId: number;
  method: "player_id" | "email" | "phone" | "name_exact" | "name_fuzzy";
  confidence: number;
  reasons: string[];
  /** true when the evidence is strong enough to link without human review. */
  certain: boolean;
};

/**
 * Pure matching logic, in priority order:
 *   1. player ID stored on the Odoo contact (certain)
 *   2. e-mail address (certain when unique on both sides)
 *   3. phone number (certain when unique on both sides)
 *   4. exact normalised name (certain only when unique on both sides and enabled in settings)
 *   5. similar name (never certain: always sent to the admin for review)
 */
export function findCandidates(
  players: MatchPlayer[],
  customers: MatchCustomer[],
  opts: { autoConfirmExactNames: boolean; fuzzyThreshold: number },
): Candidate[] {
  const out: Candidate[] = [];
  const index = <T>(list: T[], keys: (t: T) => (string | null)[]) => {
    const m = new Map<string, T[]>();
    for (const item of list) for (const k of new Set(keys(item).filter((x): x is string => !!x))) m.set(k, [...(m.get(k) ?? []), item]);
    return m;
  };

  const custByRef = index(customers, (c) => [c.reference?.trim().toLowerCase() ?? null]);
  const custByEmail = index(customers, (c) => [normalizeEmail(c.email)]);
  const custByPhone = index(customers, (c) => [normalizePhone(c.phone), normalizePhone(c.mobile)]);
  const custByName = index(customers, (c) => [c.normalizedName || null]);
  const playersByEmail = index(players, (p) => [normalizeEmail(p.email)]);
  const playersByPhone = index(players, (p) => [normalizePhone(p.phone)]);
  const playersByName = index(players, (p) => [p.normalizedName || null]);

  for (const p of players) {
    const found = new Map<number, Candidate>();
    const add = (c: Candidate) => {
      const prev = found.get(c.customerId);
      if (!prev || c.confidence > prev.confidence) found.set(c.customerId, { ...c, reasons: [...(prev?.reasons ?? []), ...c.reasons] });
      else prev.reasons.push(...c.reasons);
    };

    for (const c of custByRef.get(p.externalId.toLowerCase()) ?? []) {
      add({ playerId: p.id, customerId: c.id, method: "player_id", confidence: 1, reasons: [`Odoo reference "${c.reference}" equals the player ID`], certain: true });
    }
    const email = normalizeEmail(p.email);
    if (email) {
      const cs = custByEmail.get(email) ?? [];
      const unique = cs.length === 1 && (playersByEmail.get(email)?.length ?? 0) === 1;
      for (const c of cs) add({ playerId: p.id, customerId: c.id, method: "email", confidence: unique ? 0.95 : 0.8, reasons: [`Same e-mail (${email})`], certain: unique });
    }
    const phone = normalizePhone(p.phone);
    if (phone) {
      const cs = custByPhone.get(phone) ?? [];
      const unique = cs.length === 1 && (playersByPhone.get(phone)?.length ?? 0) === 1;
      for (const c of cs) add({ playerId: p.id, customerId: c.id, method: "phone", confidence: unique ? 0.9 : 0.75, reasons: [`Same phone number`], certain: unique });
    }
    if (p.normalizedName) {
      const cs = custByName.get(p.normalizedName) ?? [];
      const unique = cs.length === 1 && (playersByName.get(p.normalizedName)?.length ?? 0) === 1;
      for (const c of cs) {
        add({
          playerId: p.id, customerId: c.id, method: "name_exact", confidence: unique ? 0.85 : 0.7,
          reasons: [unique ? "Identical name (unique in both systems)" : "Identical name, but the name is not unique"],
          certain: unique && opts.autoConfirmExactNames,
        });
      }
      if (!found.size) {
        for (const c of customers) {
          if (!c.normalizedName) continue;
          const score = nameSimilarity(p.name, c.name);
          if (score >= opts.fuzzyThreshold) {
            add({ playerId: p.id, customerId: c.id, method: "name_fuzzy", confidence: Math.round(score * 0.8 * 100) / 100, reasons: [`Similar name (${Math.round(score * 100)}% similar)`], certain: false });
          }
        }
      }
    }
    // Keep the best few suggestions per player.
    out.push(...[...found.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 5));
  }
  return out;
}

/**
 * Runs matching for every player that has no confirmed link yet. Certain matches are
 * linked automatically; everything else becomes a suggestion for the Unmatched Records page.
 * Decisions taken by an administrator (manual links and rejections) are never overwritten.
 */
export async function runMatching(report: SyncReporter) {
  const settings = await getSettings();
  const d = db();

  const players = await d
    .select({
      id: schema.players.id, externalId: schema.players.externalId, name: schema.players.name,
      normalizedName: schema.players.normalizedName, email: schema.players.email, phone: schema.players.phone,
    })
    .from(schema.players)
    .where(and(isNull(schema.players.deletedAt),
      sql`not exists (select 1 from ${schema.recordLinks} rl where rl.player_id = ${schema.players.id} and rl.status = 'confirmed')`));

  // Only customers that actually have customer invoices are worth matching.
  const customers = await d
    .select({
      id: schema.odooCustomers.id, name: schema.odooCustomers.name, normalizedName: schema.odooCustomers.normalizedName,
      email: schema.odooCustomers.email, phone: schema.odooCustomers.phone, mobile: schema.odooCustomers.mobile,
      reference: schema.odooCustomers.reference,
    })
    .from(schema.odooCustomers)
    .where(and(isNull(schema.odooCustomers.deletedAt),
      sql`exists (select 1 from ${schema.invoices} i where i.customer_id = ${schema.odooCustomers.id} and i.deleted_at is null)`));

  const existing = await d.select().from(schema.recordLinks);
  const existingByPair = new Map(existing.map((l) => [`${l.playerId}|${l.customerId}`, l]));

  const candidates = findCandidates(players, customers, {
    autoConfirmExactNames: settings.autoConfirmExactNames,
    fuzzyThreshold: settings.fuzzySuggestionThreshold,
  });

  // A certain match is only auto-confirmed when it is the player's single certain match.
  const certainCount = new Map<number, number>();
  for (const c of candidates) if (c.certain) certainCount.set(c.playerId, (certainCount.get(c.playerId) ?? 0) + 1);

  let confirmed = 0, suggested = 0, unchanged = 0;
  const livePairs = new Set<string>();
  const autoConfirmed = new Set(candidates.filter((c) => c.certain && certainCount.get(c.playerId) === 1).map((c) => c.playerId));
  for (const c of candidates) {
    const key = `${c.playerId}|${c.customerId}`;
    // Once a player is confidently linked, weaker alternatives are just noise.
    if (autoConfirmed.has(c.playerId) && !c.certain) continue;
    livePairs.add(key);
    const prev = existingByPair.get(key);
    if (prev?.status === "rejected" || prev?.method === "manual" || prev?.decidedBy) { unchanged++; continue; }
    const status = c.certain && certainCount.get(c.playerId) === 1 ? "confirmed" : "suggested";
    if (prev && prev.status === status && prev.method === c.method && Math.abs(prev.confidence - c.confidence) < 1e-6) { unchanged++; continue; }
    await d
      .insert(schema.recordLinks)
      .values({ playerId: c.playerId, customerId: c.customerId, status, method: c.method, confidence: c.confidence, reasons: c.reasons })
      .onConflictDoUpdate({
        target: [schema.recordLinks.playerId, schema.recordLinks.customerId],
        set: { status, method: c.method, confidence: c.confidence, reasons: c.reasons, updatedAt: new Date() },
      });
    if (status === "confirmed") confirmed++;
    else suggested++;
  }

  // Drop automatic suggestions whose evidence has disappeared (e.g. a name was corrected).
  const stale = existing.filter(
    (l) => l.status === "suggested" && !l.decidedBy && !livePairs.has(`${l.playerId}|${l.customerId}`) &&
      players.some((p) => p.id === l.playerId),
  );
  for (const l of stale) await d.delete(schema.recordLinks).where(eq(schema.recordLinks.id, l.id));

  report.merge({ processed: players.length, added: confirmed + suggested, skipped: unchanged, deleted: stale.length });
  report.note(`${confirmed} automatic link(s) confirmed, ${suggested} suggestion(s) awaiting review.`);
}

// ---------------------------------------------------------------------------
// Manual decisions (Unmatched Records page)
// ---------------------------------------------------------------------------

export async function linkManually(playerId: number, customerId: number, userId: number) {
  await db()
    .insert(schema.recordLinks)
    .values({ playerId, customerId, status: "confirmed", method: "manual", confidence: 1, reasons: ["Linked manually by an administrator"], decidedBy: userId, decidedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.recordLinks.playerId, schema.recordLinks.customerId],
      set: { status: "confirmed", decidedBy: userId, decidedAt: new Date(), updatedAt: new Date() },
    });
}

export async function decideLink(linkId: number, decision: "confirmed" | "rejected", userId: number) {
  await db()
    .update(schema.recordLinks)
    .set({ status: decision, decidedBy: userId, decidedAt: new Date() })
    .where(eq(schema.recordLinks.id, linkId));
}

/** Unlinking keeps a "rejected" record so the same automatic match is not proposed again. */
export async function unlink(linkId: number, userId: number) {
  await decideLink(linkId, "rejected", userId);
}
