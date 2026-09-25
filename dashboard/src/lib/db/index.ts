import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "../env";

export type DB = NodePgDatabase<typeof schema>;

type Holder = { pool?: Pool; db?: DB };
// Survive Next.js hot reloads in development without leaking connection pools.
const holder = globalThis as unknown as { __bfaDb?: Holder };
holder.__bfaDb ??= {};

export function pool(): Pool {
  const h = holder.__bfaDb!;
  if (!h.pool) {
    const e = env();
    h.pool = new Pool({
      connectionString: e.DATABASE_URL,
      // Serverless hosts run many small instances; keep each one's share of connections low.
      max: process.env.VERCEL ? 3 : 10,
      idleTimeoutMillis: 30_000,
      ssl: e.DATABASE_SSL === "disable" ? undefined : { rejectUnauthorized: e.DATABASE_SSL === "require" },
    });
    h.pool.on("error", (err) => console.error("[db] idle client error", err.message));
  }
  return h.pool;
}

export function db(): DB {
  const h = holder.__bfaDb!;
  h.db ??= drizzle(pool(), { schema });
  return h.db;
}

export async function closeDb() {
  const h = holder.__bfaDb!;
  await h.pool?.end();
  h.pool = undefined;
  h.db = undefined;
}

export { schema };
