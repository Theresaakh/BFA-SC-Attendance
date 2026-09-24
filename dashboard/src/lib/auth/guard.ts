import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, validateSessionToken, type SessionUser } from "./session";

/** Resolves the logged-in user for the current request (memoised per request). */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return validateSessionToken(jar.get(SESSION_COOKIE)?.value);
});

/** For pages/layouts and server actions: redirects to the login page when not signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

/** For server actions that change data: only administrators may proceed. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError(403, "Administrator permission required.");
  return user;
}

/** For route handlers: returns the user or throws an AuthError (401/403). */
export async function apiUser(opts: { admin?: boolean; mutating?: boolean } = {}): Promise<SessionUser> {
  if (opts.mutating) await assertSameOrigin();
  const user = await currentUser();
  if (!user) throw new AuthError(401, "Not signed in.");
  if (opts.admin && user.role !== "admin") throw new AuthError(403, "Administrator permission required.");
  return user;
}

/** CSRF defence for state-changing route handlers: the request must come from our own pages. */
export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!origin || !host) throw new AuthError(403, "Missing origin.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AuthError(403, "Invalid origin.");
  }
  if (originHost !== host) throw new AuthError(403, "Cross-site request blocked.");
}

export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
  return null;
}
