import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { hashPassword, passwordProblems } from "./password";

export async function findUserByEmail(email: string) {
  const rows = await db()
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return rows[0] ?? null;
}

export async function createUser(input: { email: string; name: string; password: string; role?: "admin" | "viewer" }) {
  const problem = passwordProblems(input.password);
  if (problem) throw new Error(problem);
  if (await findUserByEmail(input.email)) throw new Error("A user with this e-mail already exists.");
  const [row] = await db()
    .insert(schema.users)
    .values({
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      role: input.role ?? "admin",
    })
    .returning({ id: schema.users.id });
  return row.id;
}

export async function setUserPassword(userId: number, password: string) {
  const problem = passwordProblems(password);
  if (problem) throw new Error(problem);
  await db()
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null })
    .where(eq(schema.users.id, userId));
}

export async function countUsers(): Promise<number> {
  const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.users);
  return row.n;
}

/** Creates the first administrator from INITIAL_ADMIN_* variables when the users table is empty. */
export async function bootstrapInitialAdmin(cfg: { email?: string; password?: string; name?: string }) {
  if (!cfg.email || !cfg.password) return false;
  if ((await countUsers()) > 0) return false;
  await createUser({ email: cfg.email, password: cfg.password, name: cfg.name ?? "Administrator", role: "admin" });
  return true;
}
