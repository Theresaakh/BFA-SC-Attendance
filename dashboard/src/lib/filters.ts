import { z } from "zod";

export type RawSearchParams = Record<string, string | string[] | undefined>;

const id = z.coerce.number().int().positive().optional().catch(undefined);
const num = z.coerce.number().finite().optional().catch(undefined);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined);
const text = z.string().trim().max(100).optional().catch(undefined).transform((v) => (v ? v : undefined));

/** Every filter the app understands. Invalid values are dropped rather than raising errors. */
export const filterSchema = z.object({
  q: text,
  player: id,
  branch: id,
  team: id,
  coach: id,
  from: isoDate,
  to: isoDate,
  invoiceState: z.enum(["posted", "draft", "cancel", "all"]).optional().catch(undefined),
  payment: z.enum(["paid", "partial", "unpaid", "in_payment", "overdue", "open"]).optional().catch(undefined),
  finance: z.enum(["paid", "partial", "unpaid", "overdue", "none", "outstanding"]).optional().catch(undefined),
  attendanceStatus: z.enum(["present", "absent"]).optional().catch(undefined),
  attMin: num,
  attMax: num,
  amountMin: num,
  amountMax: num,
  outMin: num,
  outMax: num,
  linked: z.enum(["yes", "no"]).optional().catch(undefined),
  sort: z.string().regex(/^[a-zA-Z_]+$/).max(40).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).optional().catch(undefined),
});

export type Filters = Partial<z.infer<typeof filterSchema>>;

export function parseFilters(sp: RawSearchParams): Filters {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) flat[k] = Array.isArray(v) ? v[0] : v;
  for (const k of Object.keys(flat)) if (flat[k] === "") delete flat[k];
  return filterSchema.parse(flat);
}

/** Serialises filters back into a query string (for pagination, sorting and export links). */
export function toQuery(f: Partial<Filters> & Record<string, unknown>, overrides: Record<string, string | number | undefined | null> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...overrides })) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function activeFilterCount(f: Filters): number {
  return Object.entries(f).filter(([k, v]) => v !== undefined && !["sort", "dir", "page"].includes(k)).length;
}

export const PAGE_SIZE = 25;
