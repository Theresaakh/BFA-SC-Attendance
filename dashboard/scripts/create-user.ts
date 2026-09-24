/**
 * Create an administrator (or viewer) account.
 *
 *   npm run user:create -- --email admin@bfa-lebanon.com --name "BFA Admin" [--role viewer]
 *
 * The password is read from the NEW_USER_PASSWORD environment variable if set, otherwise
 * it is prompted for (input hidden), so it never appears in shell history.
 */
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { createUser } from "../src/lib/auth/users";
import { closeDb } from "../src/lib/db";

async function promptHidden(question: string): Promise<string> {
  let muted = false;
  const out = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); } });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
    muted = true;
  });
}

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "admin" } } });
  if (!values.email || !values.name) throw new Error('Usage: npm run user:create -- --email <email> --name "<name>" [--role admin|viewer]');
  if (values.role !== "admin" && values.role !== "viewer") throw new Error("--role must be admin or viewer");
  let password = process.env.NEW_USER_PASSWORD;
  if (!password) {
    password = await promptHidden("Password (min. 10 characters, letters and numbers): ");
    const again = await promptHidden("Repeat password: ");
    if (password !== again) throw new Error("Passwords do not match.");
  }
  const id = await createUser({ email: values.email, name: values.name, password, role: values.role });
  console.log(`Created ${values.role} #${id} <${values.email.toLowerCase()}>.`);
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(closeDb);
