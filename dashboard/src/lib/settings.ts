import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db";
import { env } from "./env";

/**
 * Admin-editable settings, stored in the database so they can be changed from the
 * Settings page without redeploying. Environment variables provide the defaults.
 */
export const settingsSchema = z.object({
  syncIntervalMinutes: z.number().int().min(0).max(24 * 60),
  lowAttendanceThreshold: z.number().min(0).max(100),
  autoConfirmExactNames: z.boolean(),
  fuzzySuggestionThreshold: z.number().min(0.5).max(0.99),
});

export type AppSettings = z.infer<typeof settingsSchema>;

function defaults(): AppSettings {
  return {
    syncIntervalMinutes: env().SYNC_INTERVAL_MINUTES,
    lowAttendanceThreshold: 70,
    autoConfirmExactNames: true,
    fuzzySuggestionThreshold: 0.72,
  };
}

const SETTINGS_KEY = "app";

export async function getSettings(): Promise<AppSettings> {
  const rows = await db().select().from(schema.appSettings).where(eq(schema.appSettings.key, SETTINGS_KEY)).limit(1);
  const stored = settingsSchema.partial().safeParse(rows[0]?.value ?? {});
  return { ...defaults(), ...(stored.success ? stored.data : {}) };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  await setKv(SETTINGS_KEY, next);
  return next;
}

export async function getKv<T>(key: string): Promise<T | null> {
  const rows = await db().select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).limit(1);
  return (rows[0]?.value as T) ?? null;
}

export async function setKv(key: string, value: unknown) {
  await db()
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}
