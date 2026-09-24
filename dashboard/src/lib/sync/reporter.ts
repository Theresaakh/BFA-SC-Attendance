import { errorMessage, IntegrationError } from "../integrations/errors";

export type SyncErrorEntry = {
  entityType: string | null;
  externalId: string | null;
  message: string;
  details?: Record<string, unknown>;
};

/** Collects the statistics and record-level errors of one synchronisation run. */
export class SyncReporter {
  processed = 0;
  added = 0;
  updated = 0;
  skipped = 0;
  deleted = 0;
  errors: SyncErrorEntry[] = [];
  notes: string[] = [];

  error(entityType: string | null, externalId: string | number | null, err: unknown, details?: Record<string, unknown>) {
    const message = errorMessage(err);
    this.errors.push({
      entityType,
      externalId: externalId === null ? null : String(externalId),
      message,
      details: { ...(err instanceof IntegrationError ? { kind: err.kind } : {}), ...details },
    });
  }

  note(message: string) {
    this.notes.push(message);
  }

  merge(counts: { added?: number; updated?: number; skipped?: number; deleted?: number; processed?: number }) {
    this.added += counts.added ?? 0;
    this.updated += counts.updated ?? 0;
    this.skipped += counts.skipped ?? 0;
    this.deleted += counts.deleted ?? 0;
    this.processed += counts.processed ?? 0;
  }
}
