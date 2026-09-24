"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guard";
import { decideLink, linkManually, unlink } from "@/lib/matching/engine";

const idSchema = z.coerce.number().int().positive();

export type ActionResult = { ok: boolean; error?: string };

function done(): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function acceptSuggestion(linkId: number): Promise<ActionResult> {
  const user = await requireAdmin();
  const id = idSchema.safeParse(linkId);
  if (!id.success) return { ok: false, error: "Invalid link." };
  const [link] = await db().select().from(schema.recordLinks).where(eq(schema.recordLinks.id, id.data)).limit(1);
  if (!link) return { ok: false, error: "This suggestion no longer exists. Refresh the page." };
  await decideLink(id.data, "confirmed", user.id);
  // Accepting one candidate for a player dismisses that player's other pending suggestions.
  await db()
    .update(schema.recordLinks)
    .set({ status: "rejected", decidedBy: user.id, decidedAt: new Date() })
    .where(and(eq(schema.recordLinks.playerId, link.playerId), eq(schema.recordLinks.status, "suggested")));
  return done();
}

export async function rejectSuggestion(linkId: number): Promise<ActionResult> {
  const user = await requireAdmin();
  const id = idSchema.safeParse(linkId);
  if (!id.success) return { ok: false, error: "Invalid link." };
  await decideLink(id.data, "rejected", user.id);
  return done();
}

export async function linkRecords(playerId: number, customerId: number): Promise<ActionResult> {
  const user = await requireAdmin();
  const p = idSchema.safeParse(playerId);
  const c = idSchema.safeParse(customerId);
  if (!p.success || !c.success) return { ok: false, error: "Choose both a player and an Odoo customer." };
  const [player] = await db().select({ id: schema.players.id }).from(schema.players).where(eq(schema.players.id, p.data)).limit(1);
  const [customer] = await db().select({ id: schema.odooCustomers.id }).from(schema.odooCustomers).where(eq(schema.odooCustomers.id, c.data)).limit(1);
  if (!player || !customer) return { ok: false, error: "The player or customer no longer exists. Refresh the page." };
  await linkManually(p.data, c.data, user.id);
  return done();
}

export async function unlinkRecords(linkId: number): Promise<ActionResult> {
  const user = await requireAdmin();
  const id = idSchema.safeParse(linkId);
  if (!id.success) return { ok: false, error: "Invalid link." };
  await unlink(id.data, user.id);
  return done();
}
