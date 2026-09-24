"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { Check, Link2, Loader2, Unlink, X } from "lucide-react";
import { acceptSuggestion, linkRecords, rejectSuggestion, unlinkRecords, type ActionResult } from "@/app/actions/matching";
import { cn } from "@/lib/cn";

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) setError(res.error ?? "Something went wrong.");
      } catch {
        setError("The action failed. Check your connection and permissions.");
      }
    });
  return { pending, error, run };
}

const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-semibold disabled:opacity-60";

export function SuggestionActions({ linkId, canEdit }: { linkId: number; canEdit: boolean }) {
  const { pending, error, run } = useAction();
  if (!canEdit) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => acceptSuggestion(linkId))} className={cn(btn, "border-good/40 bg-good-soft text-good hover:border-good")}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Link
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => rejectSuggestion(linkId))} className={cn(btn, "border-line-strong bg-surface text-ink-2 hover:bg-surface-2")}>
          <X className="h-3.5 w-3.5" aria-hidden /> Not a match
        </button>
      </div>
      {error ? <p className="text-xs text-bad" role="alert">{error}</p> : null}
    </div>
  );
}

export function UnlinkButton({ linkId, canEdit }: { linkId: number; canEdit: boolean }) {
  const { pending, error, run } = useAction();
  if (!canEdit) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => { if (confirm("Unlink these records? The automatic match will not be proposed again.")) run(() => unlinkRecords(linkId)); }}
        className={cn(btn, "border-line-strong bg-surface text-bad hover:bg-bad-soft")}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Unlink className="h-3.5 w-3.5" aria-hidden />} Unlink
      </button>
      {error ? <p className="text-xs text-bad" role="alert">{error}</p> : null}
    </div>
  );
}

type Found = { id: number; name: string; email?: string | null; phone?: string | null; reference?: string | null; invoice_count?: number; team_name?: string | null; branch_name?: string | null; odoo_id?: number };

/** Search the other system and link the chosen record to this one. */
export function LinkPicker({ from, fromId, canEdit, initialQuery }: { from: "player" | "customer"; fromId: number; canEdit: boolean; initialQuery?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(initialQuery ?? "");
  const [results, setResults] = useState<Found[]>([]);
  const [loading, setLoading] = useState(false);
  const { pending, error, run } = useAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const target = from === "player" ? "customer" : "player";

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/matching/search?type=${target}&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        if (res.ok) setResults(((await res.json()) as { results: Found[] }).results);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open, target]);

  if (!canEdit) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn(btn, "border-line-strong bg-surface text-ink hover:bg-surface-2")}>
        <Link2 className="h-3.5 w-3.5" aria-hidden /> Link manually
      </button>
    );
  }
  return (
    <div className="w-full min-w-[280px] rounded-xl border border-line-strong bg-surface p-3 text-left shadow-lg sm:w-96">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink">Find the {target === "customer" ? "Odoo customer" : "player"}</p>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={target === "customer" ? "Name, e-mail, phone or reference" : "Player name or ID"}
        className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm focus:border-info focus:outline-none focus:ring-2 focus:ring-info/20"
        maxLength={100}
      />
      <ul className="mt-2 max-h-64 overflow-y-auto">
        {loading ? <li className="px-2 py-3 text-center text-xs text-muted"><Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden /></li> : null}
        {!loading && q.trim().length >= 2 && !results.length ? <li className="px-2 py-3 text-center text-xs text-muted">No results.</li> : null}
        {results.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => (from === "player" ? linkRecords(fromId, r.id) : linkRecords(r.id, fromId)))}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2 disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{r.name}</span>
                <span className="block truncate text-xs text-muted">
                  {target === "customer"
                    ? [r.odoo_id && `Odoo #${r.odoo_id}`, r.email, r.phone, r.reference && `Ref ${r.reference}`, `${r.invoice_count ?? 0} invoice(s)`].filter(Boolean).join(" · ")
                    : [r.team_name, r.branch_name].filter(Boolean).join(" · ") || "No team"}
                </span>
              </span>
              <Link2 className="h-4 w-4 text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-xs text-bad" role="alert">{error}</p> : null}
    </div>
  );
}
