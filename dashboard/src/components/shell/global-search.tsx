"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Loader2, ReceiptText, Search, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/cn";

type Result = { type: "player" | "coach" | "invoice" | "customer"; id: number; title: string; subtitle: string; href: string };

const ICON = { player: Users, coach: UserRound, invoice: ReceiptText, customer: ReceiptText };

/** Type-ahead search across players, coaches, invoices and Odoo customers. */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) {
          const json = (await res.json()) as { results: Result[] };
          setResults(json.results);
          setActive(0);
          setOpen(true);
        }
      } catch {
        /* aborted or offline */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const go = (r: Result) => {
    setOpen(false);
    setQ("");
    router.push(r.href);
  };

  const showList = open && q.trim().length >= 2;
  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (e.target.value.trim().length < 2) {
            setResults([]);
            setOpen(false);
          }
        }}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]); }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search players, coaches, invoices…"
        className="h-10 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-9 text-sm text-ink placeholder:text-muted focus:border-info focus:bg-surface focus:outline-none focus:ring-2 focus:ring-info/20"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Global search"
        maxLength={100}
      />
      {loading ? <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted" aria-hidden /> : (
        <kbd className="pointer-events-none absolute right-2.5 top-2.5 hidden rounded border border-line px-1.5 text-[11px] text-muted sm:block">/</kbd>
      )}
      {showList ? (
        <ul id={listId} role="listbox" className="absolute z-40 mt-2 max-h-[70vh] w-full overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          {results.length === 0 && !loading ? <li className="px-3 py-6 text-center text-sm text-muted">No matches for “{q.trim()}”.</li> : null}
          {results.map((r, i) => {
            const Icon = ICON[r.type];
            return (
              <li
                key={`${r.type}-${r.id}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); go(r); }}
                className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2", i === active && "bg-surface-2")}
              >
                <span className="rounded-md bg-surface-3 p-1.5 text-ink-2"><Icon className="h-4 w-4" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{r.title}</span>
                  <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{r.type}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
