"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";

type Status = {
  running: boolean;
  lastSuccessAt: string | null;
  sources: { source: "odoo" | "bfa"; lastSuccessAt: string | null; lastRun: { status: string; message: string | null; startedAt: string } | null }[];
};

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const LABEL = { odoo: "Odoo", bfa: "Attendance" } as const;

/** "Sync Now" button with the time of the last successful synchronisation. */
export function SyncButton({ initial, canSync }: { initial: Status; canSync: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initial);
  const [busy, setBusy] = useState(initial.running);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [, tick] = useState(0);
  const polling = useRef(false);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch("/api/sync", { cache: "no-store" });
        if (!res.ok) break;
        const s = (await res.json()) as Status;
        setStatus(s);
        if (!s.running) {
          const failed = s.sources.filter((x) => x.lastRun?.status === "failed");
          const partial = s.sources.filter((x) => x.lastRun?.status === "partial");
          setMessage(
            failed.length
              ? { tone: "error", text: failed.map((f) => `${LABEL[f.source]}: ${f.lastRun?.message ?? "failed"}`).join(" · ") }
              : partial.length
                ? { tone: "error", text: `Finished with warnings (${partial.map((p) => LABEL[p.source]).join(", ")}). See Sync logs.` }
                : { tone: "ok", text: "Synchronisation complete." },
          );
          router.refresh();
          break;
        }
      }
    } finally {
      polling.current = false;
      setBusy(false);
    }
  }, [router]);

  useEffect(() => {
    if (initial.running) void poll();
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [initial.running, poll]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.tone === "ok" ? 5000 : 15000);
    return () => clearTimeout(t);
  }, [message]);

  const start = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok && res.status !== 409) {
        setMessage({ tone: "error", text: json.error ?? "Could not start the synchronisation." });
        setBusy(false);
        return;
      }
      await poll();
    } catch {
      setMessage({ tone: "error", text: "Network error: could not reach the server." });
      setBusy(false);
    }
  };

  const last = status.lastSuccessAt;
  const detail = status.sources.map((s) => `${LABEL[s.source]}: ${s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : "never synced"}`).join("\n");
  return (
    <div className="relative flex items-center gap-3">
      <div className="hidden text-right leading-tight md:block" title={detail}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Last sync</p>
        <p className="text-[13px] font-semibold text-ink" suppressHydrationWarning>{busy ? "Syncing…" : ago(last)}</p>
      </div>
      {canSync ? (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-red px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-[#a91b27] disabled:cursor-wait disabled:opacity-80"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          <span className="hidden sm:inline">{busy ? "Syncing…" : "Sync now"}</span>
        </button>
      ) : null}
      {message ? (
        <div
          role="status"
          className={cn(
            "absolute right-0 top-12 z-40 flex w-80 gap-2 rounded-xl border bg-surface p-3 text-sm shadow-xl",
            message.tone === "ok" ? "border-good/30" : "border-bad/30",
          )}
        >
          {message.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden />}
          <p className="text-ink">{message.text}</p>
        </div>
      ) : null}
    </div>
  );
}
