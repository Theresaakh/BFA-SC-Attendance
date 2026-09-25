import { createSign } from "node:crypto";
import { IntegrationError, friendlyNetworkError, withRetry } from "../errors";

/**
 * Read-only client for the BFA attendance app's data store.
 *
 * The attendance app (app.bfa-lebanon.com, source in this repository's teams.html) has no
 * server or REST API of its own: the browser reads and writes a Firebase Realtime Database
 * directly. The official, supported way for a backend to read that data is the Firebase
 * Realtime Database REST API, authenticated with a Google service account (read-only
 * access is enough). A legacy database secret is also accepted.
 *
 * Only the data children the dashboard needs are requested, and the `auth` child (which
 * holds the app's PIN codes) is never read.
 */

export type BfaClientConfig = {
  databaseUrl: string;
  rootPath: string;
  authMode: "service_account" | "database_secret" | "none";
  serviceAccountJson?: string;
  databaseSecret?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export const BFA_CHILDREN = ["branches", "teams", "players", "attendance", "staffAttendance"] as const;
export type BfaChild = (typeof BFA_CHILDREN)[number];

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

const SYSTEM = "BFA attendance" as const;
const SCOPES = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email";

export class BfaClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: BfaClientConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    if (cfg.rootPath.split("/").some((seg) => seg === "auth")) {
      throw new IntegrationError(SYSTEM, "not_configured", "BFA_FIREBASE_ROOT_PATH must point at the app's data root, not its auth node.");
    }
  }

  async fetchChild(child: BfaChild): Promise<unknown> {
    const url = new URL(`${this.cfg.databaseUrl}/${this.cfg.rootPath}/${child}.json`);
    const auth = await this.authParam();
    if (auth) url.searchParams.set(auth.name, auth.value);
    return withRetry(async () => {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.cfg.timeoutMs), cache: "no-store" });
      } catch (err) {
        throw friendlyNetworkError(SYSTEM, err, this.cfg.timeoutMs);
      }
      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new IntegrationError(SYSTEM, "auth",
          "The attendance database refused access. Check the service account / database secret and the database security rules.",
          { httpStatus: res.status });
      }
      if (res.status === 404) {
        throw new IntegrationError(SYSTEM, "not_configured", "Attendance database not found. Check BFA_FIREBASE_DATABASE_URL.", { httpStatus: 404 });
      }
      if (!res.ok) {
        throw new IntegrationError(SYSTEM, res.status >= 500 ? "server" : "invalid_response", `Attendance database returned HTTP ${res.status}.`, { httpStatus: res.status });
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new IntegrationError(SYSTEM, "invalid_response", "Attendance database returned data that is not JSON.");
      }
    });
  }

  async fetchAll(): Promise<Record<BfaChild, unknown>> {
    const entries = await Promise.all(BFA_CHILDREN.map(async (c) => [c, await this.fetchChild(c)] as const));
    return Object.fromEntries(entries) as Record<BfaChild, unknown>;
  }

  private async authParam(): Promise<{ name: string; value: string } | null> {
    if (this.cfg.authMode === "none") return null;
    if (this.cfg.authMode === "database_secret") return { name: "auth", value: this.cfg.databaseSecret ?? "" };
    return { name: "access_token", value: await this.accessToken() };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
    const sa = parseServiceAccount(this.cfg.serviceAccountJson);
    const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: SCOPES, aud: tokenUri, iat: now, exp: now + 3600 })}`;
    let signature: string;
    try {
      signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
    } catch {
      throw new IntegrationError(SYSTEM, "not_configured", "The service account private key could not be used. Check BFA_FIREBASE_SERVICE_ACCOUNT_JSON.");
    }
    let res: Response;
    try {
      res = await this.fetchImpl(tokenUri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw friendlyNetworkError(SYSTEM, err, this.cfg.timeoutMs);
    }
    const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
    if (!res.ok || !json?.access_token) {
      throw new IntegrationError(SYSTEM, "auth", `Google rejected the service account: ${json?.error_description ?? `HTTP ${res.status}`}.`);
    }
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }
}

function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw) throw new IntegrationError(SYSTEM, "not_configured", "BFA_FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
  let text = raw.trim();
  // Accept either the raw JSON or its base64 encoding (easier to store in some secret managers).
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8");
    } catch {
      /* fall through to JSON error */
    }
  }
  try {
    const sa = JSON.parse(text) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) throw new Error("missing fields");
    return sa;
  } catch {
    throw new IntegrationError(SYSTEM, "not_configured", "BFA_FIREBASE_SERVICE_ACCOUNT_JSON is not a valid service account key (JSON or base64 JSON).");
  }
}
