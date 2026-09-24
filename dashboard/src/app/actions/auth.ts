"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, cookieSecure, createSession, deleteSession, deleteUserSessions } from "@/lib/auth/session";
import { findUserByEmail, setUserPassword } from "@/lib/auth/users";
import { requireUser } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/rate-limit";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid e-mail address.").max(200),
  password: z.string().min(1, "Enter your password.").max(200),
  next: z.string().max(300).optional(),
});

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  const email = String(formData.get("email") ?? "").slice(0, 200);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input.", email };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!rateLimit(`login:${ip}`, 10, 60_000)) return { error: "Too many sign-in attempts. Please wait a minute and try again.", email };

  const user = await findUserByEmail(parsed.data.email);
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return { error: `This account is temporarily locked after repeated failed sign-ins. Try again in ${minutes} minute(s).`, email };
  }
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash);
  if (!user || !ok || !user.isActive) {
    if (user) {
      const failures = user.failedLoginCount + 1;
      await db()
        .update(schema.users)
        .set({ failedLoginCount: failures >= MAX_FAILURES ? 0 : failures, lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(schema.users.id, user.id));
    }
    return { error: "Incorrect e-mail or password.", email };
  }

  await db().update(schema.users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
  const { token, expiresAt } = await createSession(user.id, { ip, userAgent: h.get("user-agent") });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  redirect(safeNext(parsed.data.next));
}

export async function logout() {
  const jar = await cookies();
  await deleteSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export type PasswordState = { error?: string; ok?: boolean };

export async function changePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next !== confirm) return { error: "The new passwords do not match." };
  const [row] = await db().select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (!(await verifyPassword(current, row?.passwordHash))) return { error: "Your current password is incorrect." };
  try {
    await setUserPassword(user.id, next);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change the password." };
  }
  // Sign out every other device; keep this session.
  const jar = await cookies();
  await deleteUserSessions(user.id);
  const { token: fresh, expiresAt } = await createSession(user.id, {});
  jar.set(SESSION_COOKIE, fresh, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", expires: expiresAt });
  return { ok: true };
}
