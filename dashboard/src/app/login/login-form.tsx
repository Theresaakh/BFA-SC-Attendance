"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { login, type LoginState } from "@/app/actions/auth";
import { inputClass } from "@/components/filter-bar";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.error ? (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-ink">
          {state.error}
        </p>
      ) : null}
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink-2">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} className={`${inputClass} h-11`} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-semibold text-ink-2">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={`${inputClass} h-11`} />
      </div>
      <button type="submit" disabled={pending} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-navy text-sm font-semibold text-white hover:bg-navy-deep disabled:opacity-70 dark:bg-navy dark:text-navy-deep">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
