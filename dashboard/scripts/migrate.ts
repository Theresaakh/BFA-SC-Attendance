import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, closeDb } from "../src/lib/db";

async function main() {
  await migrate(db(), { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
