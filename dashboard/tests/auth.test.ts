import { beforeEach, describe, expect, it } from "vitest";
import { createUser, findUserByEmail } from "@/lib/auth/users";
import { createSession, deleteSession, hashToken, validateSessionToken } from "@/lib/auth/session";
import { passwordProblems, verifyPassword } from "@/lib/auth/password";
import { db, schema } from "@/lib/db";
import { resetDatabase } from "./helpers/db";

beforeEach(resetDatabase);

describe("auth", () => {
  it("hashes passwords and enforces a policy", async () => {
    expect(passwordProblems("short1")).not.toBeNull();
    expect(passwordProblems("longenoughpassword")).not.toBeNull();
    await createUser({ email: "Admin@BFA.test", name: "Admin", password: "correct horse 42" });
    const u = await findUserByEmail("admin@bfa.test");
    expect(u?.passwordHash).not.toContain("correct");
    expect(await verifyPassword("correct horse 42", u!.passwordHash)).toBe(true);
    expect(await verifyPassword("wrong", u!.passwordHash)).toBe(false);
    await expect(createUser({ email: "admin@bfa.test", name: "x", password: "another pass 1" })).rejects.toThrow(/already exists/);
  });

  it("stores only a hash of session tokens and validates them", async () => {
    const id = await createUser({ email: "a@bfa.test", name: "A", password: "abcdefghij1" });
    const { token } = await createSession(id, { ip: "127.0.0.1" });
    const [row] = await db().select().from(schema.sessions);
    expect(row.id).toBe(hashToken(token));
    expect(row.id).not.toBe(token);
    expect(await validateSessionToken(token)).toMatchObject({ id, email: "a@bfa.test" });
    expect(await validateSessionToken(token + "x")).toBeNull();
    await deleteSession(token);
    expect(await validateSessionToken(token)).toBeNull();
  });
});
