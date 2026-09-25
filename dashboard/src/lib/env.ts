import { z } from "zod";

if (typeof window !== "undefined") {
  throw new Error("src/lib/env.ts must never be imported into browser code.");
}

/**
 * Server-side configuration. Every secret lives in environment variables and is only
 * ever read here, on the server. Nothing in this file is exposed to the browser
 * (no NEXT_PUBLIC_ variables are used anywhere in the app).
 */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_SSL: z.enum(["disable", "require", "no-verify"]).default("disable"),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),

  INITIAL_ADMIN_EMAIL: optionalString,
  INITIAL_ADMIN_PASSWORD: optionalString,
  INITIAL_ADMIN_NAME: optionalString,

  // Odoo (customer invoices)
  ODOO_URL: optionalString,
  ODOO_DB: optionalString,
  ODOO_LOGIN: optionalString,
  ODOO_API_KEY: optionalString,
  ODOO_API_PROTOCOL: z.enum(["auto", "jsonrpc", "json2"]).default("auto"),
  ODOO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  ODOO_COMPANY_ID: z.coerce.number().int().positive().optional(),
  ODOO_PLAYER_ID_FIELD: z.string().default("ref"),
  ODOO_INVOICE_START_DATE: optionalString,

  // BFA attendance app (Firebase Realtime Database behind app.bfa-lebanon.com)
  BFA_FIREBASE_DATABASE_URL: optionalString,
  BFA_FIREBASE_ROOT_PATH: z.string().default("bfaTeamsState"),
  BFA_FIREBASE_AUTH_MODE: z.enum(["service_account", "database_secret", "none"]).default("service_account"),
  BFA_FIREBASE_SERVICE_ACCOUNT_JSON: optionalString,
  BFA_FIREBASE_DATABASE_SECRET: optionalString,
  BFA_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),

  // Synchronisation
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(24 * 60).default(60),
  SYNC_SCHEDULER_ENABLED: z.enum(["true", "false"]).default("true"),
  CRON_SECRET: optionalString,
  APP_TIMEZONE: z.string().default("Asia/Beirut"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached configuration so process.env changes take effect. */
export function resetEnvCache() {
  cached = undefined;
}

export function odooConfig() {
  const e = env();
  const missing = (
    [
      ["ODOO_URL", e.ODOO_URL],
      ["ODOO_DB", e.ODOO_DB],
      ["ODOO_LOGIN", e.ODOO_LOGIN],
      ["ODOO_API_KEY", e.ODOO_API_KEY],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return {
    configured: missing.length === 0,
    missing,
    url: e.ODOO_URL?.replace(/\/+$/, "") ?? "",
    db: e.ODOO_DB ?? "",
    login: e.ODOO_LOGIN ?? "",
    apiKey: e.ODOO_API_KEY ?? "",
    protocol: e.ODOO_API_PROTOCOL,
    timeoutMs: e.ODOO_TIMEOUT_MS,
    companyId: e.ODOO_COMPANY_ID,
    playerIdField: e.ODOO_PLAYER_ID_FIELD,
    invoiceStartDate: e.ODOO_INVOICE_START_DATE,
  };
}

export function bfaConfig() {
  const e = env();
  const missing: string[] = [];
  if (!e.BFA_FIREBASE_DATABASE_URL) missing.push("BFA_FIREBASE_DATABASE_URL");
  if (e.BFA_FIREBASE_AUTH_MODE === "service_account" && !e.BFA_FIREBASE_SERVICE_ACCOUNT_JSON)
    missing.push("BFA_FIREBASE_SERVICE_ACCOUNT_JSON");
  if (e.BFA_FIREBASE_AUTH_MODE === "database_secret" && !e.BFA_FIREBASE_DATABASE_SECRET)
    missing.push("BFA_FIREBASE_DATABASE_SECRET");
  return {
    configured: missing.length === 0,
    missing,
    databaseUrl: e.BFA_FIREBASE_DATABASE_URL?.replace(/\/+$/, "") ?? "",
    rootPath: e.BFA_FIREBASE_ROOT_PATH.replace(/^\/+|\/+$/g, ""),
    authMode: e.BFA_FIREBASE_AUTH_MODE,
    serviceAccountJson: e.BFA_FIREBASE_SERVICE_ACCOUNT_JSON,
    databaseSecret: e.BFA_FIREBASE_DATABASE_SECRET,
    timeoutMs: e.BFA_TIMEOUT_MS,
  };
}
