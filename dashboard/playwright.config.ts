import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://bfa:bfa_dev_pw@localhost:5432/bfa_e2e";
process.env.E2E_DATABASE_URL = DATABASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL,
      SYNC_SCHEDULER_ENABLED: "false",
      ODOO_URL: "",
      ODOO_DB: "",
      ODOO_LOGIN: "",
      ODOO_API_KEY: "",
      BFA_FIREBASE_DATABASE_URL: "",
      CRON_SECRET: "e2e-cron-secret-value",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
