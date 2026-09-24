import { resetEnvCache } from "../../src/lib/env";

/** Resets the e2e database and loads the fixture data through the real sync code. */
export default async function globalSetup() {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  resetEnvCache();
  const { resetDatabase } = await import("../helpers/db");
  const { createUser } = await import("../../src/lib/auth/users");
  const { syncBfa } = await import("../../src/lib/integrations/bfa/sync");
  const { syncOdoo } = await import("../../src/lib/integrations/odoo/sync");
  const { OdooClient } = await import("../../src/lib/integrations/odoo/client");
  const { runMatching } = await import("../../src/lib/matching/engine");
  const { SyncReporter } = await import("../../src/lib/sync/reporter");
  const { closeDb } = await import("../../src/lib/db");
  const { fakeOdoo } = await import("../helpers/fake-odoo");
  const { bfaRaw, odooData } = await import("../helpers/fixtures");

  await resetDatabase();
  await createUser({ email: "admin@e2e.test", name: "E2E Admin", password: "E2eAdminPass1", role: "admin" });
  await createUser({ email: "viewer@e2e.test", name: "E2E Viewer", password: "E2eViewerPass1", role: "viewer" });
  await syncBfa(new SyncReporter(), { raw: bfaRaw() });
  const odoo = fakeOdoo(odooData());
  await syncOdoo(new SyncReporter(), {
    client: new OdooClient({ url: "https://odoo.test", db: "bfa", login: "e2e", apiKey: odoo.apiKey, protocol: "auto", timeoutMs: 5000, fetchImpl: odoo.fetchImpl }),
  });
  await runMatching(new SyncReporter());
  await closeDb();
}
