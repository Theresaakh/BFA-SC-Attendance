import { IntegrationError, friendlyNetworkError, withRetry } from "../errors";

/**
 * Minimal client for Odoo's official external API.
 *
 * Two transports are supported:
 *  - "jsonrpc": the classic external API (`/jsonrpc`, services `common` and `object`),
 *    available on every Odoo version up to and including 19.
 *  - "json2":   the JSON-2 API introduced in Odoo 19 (`/json/2/<model>/<method>`, bearer API key),
 *    which replaces XML-RPC/JSON-RPC in later versions.
 * "auto" probes `/jsonrpc` first and falls back to JSON-2 when it is not available.
 *
 * Authentication always uses an Odoo API key (Settings → Users → Account Security → New API Key);
 * the key is only ever sent from the server.
 */

export type OdooDomain = unknown[];
export type Many2one = [number, string] | false;

export type OdooClientConfig = {
  url: string;
  db: string;
  login: string;
  apiKey: string;
  protocol: "auto" | "jsonrpc" | "json2";
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export type OdooServerInfo = {
  serverVersion: string;
  majorVersion: number | null;
  protocol: "jsonrpc" | "json2";
  uid: number | null;
};

type SearchReadOptions = { limit?: number; offset?: number; order?: string; context?: Record<string, unknown> };

const SYSTEM = "Odoo" as const;

export class OdooClient {
  private info: OdooServerInfo | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: OdooClientConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  get serverInfo() {
    return this.info;
  }

  /** Detects the API flavour and authenticates. Must be called before any other method. */
  async connect(): Promise<OdooServerInfo> {
    if (this.info) return this.info;
    let protocol = this.cfg.protocol;
    type VersionInfo = { server_version?: string; server_version_info?: unknown[] } | null;
    let version: VersionInfo = null;

    if (protocol === "auto" || protocol === "jsonrpc") {
      try {
        version = (await this.jsonRpc("common", "version", [])) as VersionInfo;
        protocol = "jsonrpc";
      } catch (err) {
        const notAvailable = err instanceof IntegrationError && err.details?.httpStatus !== undefined &&
          [404, 405, 410].includes(err.details.httpStatus as number);
        if (protocol === "jsonrpc" || !notAvailable) throw err;
        protocol = "json2";
      }
    }

    if (protocol === "json2") {
      version = await this.webVersion();
      // JSON-2 authenticates each request with the API key; verify it with a cheap call.
      const me = (await this.json2("res.users", "context_get", {})) as { uid?: number } | null;
      this.info = {
        serverVersion: version?.server_version ?? "unknown",
        majorVersion: parseMajor(version),
        protocol: "json2",
        uid: typeof me?.uid === "number" ? me.uid : null,
      };
      return this.info;
    }

    const rpcVersion = version as VersionInfo;
    const uid = await this.jsonRpc("common", "authenticate", [this.cfg.db, this.cfg.login, this.cfg.apiKey, {}]);
    if (typeof uid !== "number" || uid <= 0) {
      throw new IntegrationError(SYSTEM, "auth", "Odoo rejected the credentials. Check ODOO_DB, ODOO_LOGIN and ODOO_API_KEY.");
    }
    this.info = {
      serverVersion: rpcVersion?.server_version ?? "unknown",
      majorVersion: parseMajor(rpcVersion),
      protocol: "jsonrpc",
      uid,
    };
    return this.info;
  }

  async searchRead<T = Record<string, unknown>>(
    model: string,
    domain: OdooDomain,
    fields: string[],
    opts: SearchReadOptions = {},
  ): Promise<T[]> {
    return (await this.call(model, "search_read", { domain, fields, ...opts })) as T[];
  }

  /** Reads every matching record, paging through the result set. */
  async searchReadAll<T = Record<string, unknown>>(
    model: string,
    domain: OdooDomain,
    fields: string[],
    opts: { pageSize?: number; order?: string; context?: Record<string, unknown> } = {},
  ): Promise<T[]> {
    const pageSize = opts.pageSize ?? 500;
    const out: T[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.searchRead<T>(model, domain, fields, {
        limit: pageSize,
        offset,
        order: opts.order ?? "id asc",
        context: opts.context,
      });
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  async searchIds(model: string, domain: OdooDomain, context?: Record<string, unknown>): Promise<number[]> {
    return (await this.call(model, "search", { domain, context })) as number[];
  }

  /** Returns the names of the fields that exist on a model (fields differ between Odoo versions). */
  async fieldNames(model: string): Promise<Set<string>> {
    const res = (await this.call(model, "fields_get", { attributes: ["type"] })) as Record<string, unknown>;
    return new Set(Object.keys(res ?? {}));
  }

  // -------------------------------------------------------------------------

  private async call(model: string, method: string, kwargs: Record<string, unknown>): Promise<unknown> {
    const info = await this.connect();
    const cleaned = Object.fromEntries(Object.entries(kwargs).filter(([, v]) => v !== undefined));
    if (info.protocol === "json2") return this.json2(model, method, cleaned);

    // execute_kw takes positional args; map the common named ones.
    let args: unknown[] = [];
    const kw = { ...cleaned };
    if (method === "search_read" || method === "search") {
      args = [kw.domain ?? []];
      delete kw.domain;
    }
    return this.jsonRpc("object", "execute_kw", [this.cfg.db, info.uid, this.cfg.apiKey, model, method, args, kw]);
  }

  private async jsonRpc(service: string, method: string, args: unknown[]): Promise<unknown> {
    const body = { jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() };
    const res = await this.post(`${this.cfg.url}/jsonrpc`, body, {});
    const payload = res as { result?: unknown; error?: { message?: string; data?: { name?: string; message?: string } } };
    if (payload && typeof payload === "object" && "error" in payload && payload.error) {
      throw classifyOdooError(payload.error.data?.name, payload.error.data?.message ?? payload.error.message);
    }
    return payload?.result;
  }

  private async json2(model: string, method: string, body: Record<string, unknown>): Promise<unknown> {
    return this.post(`${this.cfg.url}/json/2/${encodeURIComponent(model)}/${encodeURIComponent(method)}`, body, {
      Authorization: `bearer ${this.cfg.apiKey}`,
      "X-Odoo-Database": this.cfg.db,
    });
  }

  private async webVersion(): Promise<{ server_version?: string; server_version_info?: unknown[] } | null> {
    try {
      const res = await this.request(`${this.cfg.url}/web/version`, { method: "GET" });
      const json = (await res.json()) as { version?: string; version_info?: unknown[] };
      return { server_version: json.version, server_version_info: json.version_info };
    } catch {
      return null;
    }
  }

  private async post(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
    return withRetry(async () => {
      const res = await this.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new IntegrationError(SYSTEM, res.ok ? "invalid_response" : httpKind(res.status),
          res.ok ? "Odoo returned a response that is not JSON. Check ODOO_URL." : `Odoo returned HTTP ${res.status}.`,
          { httpStatus: res.status });
      }
      if (!res.ok) {
        const err = json as { name?: string; message?: string } | null;
        if (err?.name || err?.message) {
          const classified = classifyOdooError(err.name, err.message);
          if (res.status === 401) throw new IntegrationError(SYSTEM, "auth", classified.message, { httpStatus: 401 });
          throw new IntegrationError(SYSTEM, classified.kind, classified.message, { httpStatus: res.status });
        }
        throw new IntegrationError(SYSTEM, httpKind(res.status), `Odoo returned HTTP ${res.status}.`, { httpStatus: res.status });
      }
      return json;
    });
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.cfg.timeoutMs), cache: "no-store" });
    } catch (err) {
      throw friendlyNetworkError(SYSTEM, err, this.cfg.timeoutMs);
    }
  }
}

function httpKind(status: number) {
  if (status === 401) return "auth" as const;
  if (status === 403) return "access" as const;
  if (status >= 500) return "server" as const;
  return "invalid_response" as const;
}

function parseMajor(v: { server_version?: string; server_version_info?: unknown[] } | null): number | null {
  const first = v?.server_version_info?.[0];
  if (typeof first === "number") return first;
  const m = /(\d+)/.exec(v?.server_version ?? "");
  return m ? Number(m[1]) : null;
}

export function classifyOdooError(name: string | undefined, message: string | undefined): IntegrationError {
  const msg = (message ?? "Unknown Odoo error").split("\n")[0].slice(0, 500);
  const n = name ?? "";
  if (/AccessDenied/.test(n)) return new IntegrationError(SYSTEM, "auth", "Odoo rejected the credentials (access denied). Check ODOO_LOGIN and ODOO_API_KEY.");
  if (/AccessError/.test(n)) return new IntegrationError(SYSTEM, "access", `The Odoo user lacks permission: ${msg}`);
  if (/KeyError|database .* does not exist/i.test(n + msg)) {
    return new IntegrationError(SYSTEM, "auth", `Odoo database not found. Check ODOO_DB. (${msg})`);
  }
  return new IntegrationError(SYSTEM, "server", `Odoo error: ${msg}`, { name: n });
}

/** Odoo returns `false` for empty values; normalise to null. */
export function odooStr(v: unknown): string | null {
  if (v === false || v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === "number" ? v[0] : null;
}

export function m2oName(v: unknown): string | null {
  return Array.isArray(v) && typeof v[1] === "string" ? v[1] : null;
}

/** Odoo datetimes are naive UTC strings ("YYYY-MM-DD HH:MM:SS"). */
export function odooDateTime(v: unknown): Date | null {
  const s = odooStr(v);
  if (!s) return null;
  const d = new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toOdooDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function odooDate(v: unknown): string | null {
  const s = odooStr(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
