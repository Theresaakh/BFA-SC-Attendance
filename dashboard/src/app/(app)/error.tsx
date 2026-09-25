"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const dbDown = /ECONNREFUSED|database|connect/i.test(error.message);
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-xl border border-line bg-surface p-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-bad" aria-hidden />
      <h1 className="mt-3 text-lg font-bold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        {dbDown ? "The dashboard database is not reachable right now." : "This page could not be loaded."} Your data is safe. Try again, and if the problem continues check the server logs
        {error.digest ? <> (reference <code>{error.digest}</code>)</> : null}.
      </p>
      <button type="button" onClick={reset} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-navy px-4 text-sm font-semibold text-white hover:bg-navy-deep">
        <RotateCcw className="h-4 w-4" aria-hidden /> Try again
      </button>
    </div>
  );
}
