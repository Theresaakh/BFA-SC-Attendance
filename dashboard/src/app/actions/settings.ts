"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guard";
import { createUser, deleteUserSessionsFor } from "@/lib/auth/users";
import { bfaConfig } from "@/lib/env";
import { BfaClient } from "@/lib/integrations/bfa/client";
import { errorMessage } from "@/lib/integrations/errors";
import { testOdooConnection } from "@/lib/integrations/odoo/sync";
import { updateSettings } from "@/lib/settings";
import { runSync } from "@/lib/sync/runner";

export type FormState = { ok?: boolean; error?: string; message?: string };

const settingsForm = z.object({
  syncIntervalMinutes: z.coerce.number().int().min(0).max(1440),
  lowAttendanceThreshold: z.coerce.number().min(1).max(100),
  fuzzySuggestionThreshold: z.coerce.number().min(50).max(99).transform((v) => v / 100),
  autoConfirmExactNames: z.preprocess((v) => v === "on", z.boolean()),
});

export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = settingsForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(" ") };
  await updateSettings(parsed.data);
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved. The new sync frequency applies immediately." };
}

export async function testOdoo(): Promise<FormState> {
  await requireAdmin();
  try {
    const info = await testOdooConnection();
    return { ok: true, message: `Connected to Odoo ${info.serverVersion} (${info.protocol === "json2" ? "JSON-2 API" : "JSON-RPC"}). ${info.postedInvoices} posted customer invoices visible.` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function testBfa(): Promise<FormState> {
  await requireAdmin();
  const cfg = bfaConfig();
  if (!cfg.configured) return { error: `Missing: ${cfg.missing.join(", ")}` };
  try {
    const client = new BfaClient(cfg);
    const [branches, teams] = await Promise.all([client.fetchChild("branches"), client.fetchChild("teams")]);
    const count = (x: unknown) => (Array.isArray(x) ? x.filter(Boolean).length : x && typeof x === "object" ? Object.keys(x).length : 0);
    if (!branches && !teams) return { error: `Connected, but "${cfg.rootPath}" has no branches or teams. Check BFA_FIREBASE_ROOT_PATH.` };
    return { ok: true, message: `Connected to the attendance database: ${count(branches)} branches, ${count(teams)} teams.` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function startFullResync(): Promise<FormState> {
  const user = await requireAdmin();
  after(async () => {
    try {
      await runSync({ trigger: "manual", userId: user.id, full: true });
    } catch (err) {
      console.error("[sync] full resync crashed:", err);
    }
  });
  return { ok: true, message: "Full resynchronisation started. Follow its progress in Sync logs." };
}

const userForm = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(100),
  email: z.string().trim().email("Enter a valid e-mail address.").max(200),
  password: z.string().max(200),
  role: z.enum(["admin", "viewer"]),
});

export async function addUser(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = userForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    await createUser(parsed.data);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/settings");
  return { ok: true, message: `Account created for ${parsed.data.email}.` };
}

export async function setUserActive(userId: number, active: boolean): Promise<FormState> {
  const me = await requireAdmin();
  const id = z.number().int().positive().safeParse(userId);
  if (!id.success) return { error: "Invalid user." };
  if (id.data === me.id) return { error: "You cannot deactivate your own account." };
  await db().update(schema.users).set({ isActive: active }).where(eq(schema.users.id, id.data));
  if (!active) await deleteUserSessionsFor(id.data);
  revalidatePath("/settings");
  return { ok: true };
}
