import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Filters } from "@/lib/filters";
import type { Option } from "@/lib/queries/lookups";

export type FilterField =
  | { name: keyof Filters & string; label: string; type: "search"; placeholder?: string }
  | { name: keyof Filters & string; label: string; type: "select"; options: { value: string | number; label: string }[]; placeholder?: string }
  | { name: keyof Filters & string; label: string; type: "date" }
  | { name: keyof Filters & string; label: string; type: "number"; placeholder?: string; step?: string };

export const inputClass =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-info focus:outline-none focus:ring-2 focus:ring-info/20";

export function optionsFrom(list: Option[]) {
  return list.map((o) => ({ value: o.id, label: o.name }));
}

/**
 * A plain GET form: every filter is part of the URL, so filters combine, survive reloads,
 * can be bookmarked and are reused for exports. Works without JavaScript.
 */
export function FilterBar({
  action,
  filters,
  primary,
  more = [],
  hidden = {},
}: {
  action: string;
  filters: Filters;
  primary: FilterField[];
  more?: FilterField[];
  hidden?: Record<string, string | undefined>;
}) {
  const moreActive = more.some((f) => filters[f.name] !== undefined);
  return (
    <form action={action} method="get" className="mb-5 rounded-xl border border-line bg-surface p-3 sm:p-4" role="search">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {filters.sort ? <input type="hidden" name="sort" value={filters.sort} /> : null}
      {filters.dir ? <input type="hidden" name="dir" value={filters.dir} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {primary.map((f) => (
          <Field key={f.name} field={f} value={filters[f.name]} wide={f.type === "search"} />
        ))}
      </div>
      {more.length ? (
        <details className="group mt-3" open={moreActive}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-ink-2 hover:text-ink">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            More filters
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {more.map((f) => (
              <Field key={f.name} field={f} value={filters[f.name]} />
            ))}
          </div>
        </details>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button type="submit" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-navy px-4 text-sm font-semibold text-white hover:bg-navy-deep dark:bg-navy dark:text-navy-deep">
          Apply filters
        </button>
        <Link href={action + (hidden.tab ? `?tab=${hidden.tab}` : "")} className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink">
          Reset
        </Link>
      </div>
    </form>
  );
}

function Field({ field, value, wide }: { field: FilterField; value: unknown; wide?: boolean }) {
  const id = `f-${field.name}`;
  const v = value === undefined || value === null ? "" : String(value);
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <label htmlFor={id} className="mb-1 block text-[12px] font-semibold text-muted">
        {field.label}
      </label>
      {field.type === "search" ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
          <input id={id} name={field.name} type="search" defaultValue={v} placeholder={field.placeholder} className={cn(inputClass, "pl-8")} maxLength={100} />
        </div>
      ) : field.type === "select" ? (
        <select id={id} name={field.name} defaultValue={v} className={inputClass}>
          <option value="">{field.placeholder ?? "All"}</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "date" ? (
        <input id={id} name={field.name} type="date" defaultValue={v} className={inputClass} />
      ) : (
        <input id={id} name={field.name} type="number" inputMode="decimal" step={field.step ?? "any"} defaultValue={v} placeholder={field.placeholder} className={inputClass} />
      )}
    </div>
  );
}
