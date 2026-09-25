export type IntegrationErrorKind =
  | "not_configured"
  | "auth"
  | "access"
  | "timeout"
  | "network"
  | "server"
  | "invalid_response";

/** An error talking to an external system, carrying a message that is safe to show an administrator. */
export class IntegrationError extends Error {
  constructor(
    public readonly system: "Odoo" | "BFA attendance",
    public readonly kind: IntegrationErrorKind,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IntegrationError";
  }

  get retryable() {
    return this.kind === "timeout" || this.kind === "network" || this.kind === "server";
  }
}

export function friendlyNetworkError(system: IntegrationError["system"], err: unknown, timeoutMs: number): IntegrationError {
  if (err instanceof IntegrationError) return err;
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === "AbortError" || e?.name === "TimeoutError") {
    return new IntegrationError(system, "timeout", `${system} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
  }
  const code = e?.cause?.code;
  const byCode: Record<string, string> = {
    ENOTFOUND: `${system} server address could not be found (DNS lookup failed). Check the configured URL.`,
    ECONNREFUSED: `${system} refused the connection. The service may be down.`,
    ECONNRESET: `The connection to ${system} was interrupted.`,
    ETIMEDOUT: `The connection to ${system} timed out.`,
    EAI_AGAIN: `${system} server address could not be resolved right now (temporary DNS failure).`,
    CERT_HAS_EXPIRED: `${system}'s TLS certificate has expired.`,
  };
  const message = (code && byCode[code]) || `${system} is unreachable: ${e?.cause?.message ?? e?.message ?? "unknown network error"}`;
  return new IntegrationError(system, "network", message, { code });
}

export async function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; baseDelayMs?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof IntegrationError) || !err.retryable || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, base * 2 ** attempt));
      attempt++;
    }
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
