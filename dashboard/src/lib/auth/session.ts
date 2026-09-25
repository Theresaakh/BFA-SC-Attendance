import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";

export const SESSION_COOKIE = "bfa_session";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "viewer";
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function cookieSecure(): boolean {
  const setting = env().COOKIE_SECURE;
  if (setting === "auto") return env().NODE_ENV === "production";
  return setting === "true";
}

export async function createSession(userId: number, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const ttlMs = env().SESSION_TTL_HOURS * 3600 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await db()
    .insert(schema.sessions)
    .values({
      id: hashToken(token),
      userId,
      expiresAt,
      ipAddress: meta.ip?.slice(0, 100) ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
  // Opportunistic clean-up of expired sessions.
  await db().delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function validateSessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const rows = await db()
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      isActive: schema.users.isActive,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || !row.isActive) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function deleteSession(token: string | undefined | null) {
  if (!token) return;
  await db().delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
}

export async function deleteUserSessions(userId: number) {
  await db().delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}
