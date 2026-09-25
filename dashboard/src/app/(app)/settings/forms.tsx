"use client";

import { useActionState, useState, useTransition } from "react";
import { CheckCircle2, Loader2, PlugZap, RotateCcw, XCircle } from "lucide-react";
import { addUser, saveSettings, setUserActive, startFullResync, testBfa, testOdoo, type FormState } from "@/app/actions/settings";
import { changePassword, type PasswordState } from "@/app/actions/auth";
import { inputClass } from "@/components/filter-bar";
import type { AppSettings } from "@/lib/settings";
import { cn } from "@/lib/cn";

function Result({ state }: { state: FormState | PasswordState }) {
  if ("error" in state && state.error) return <p role="alert" className="flex items-start gap-2 text-sm text-bad"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{state.error}</p>;
  if (state.ok) return <p role="status" className="flex items-start gap-2 text-sm text-good"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{"message" in state && state.message ? state.message : "Saved."}</p>;
  return null;
}

const label = "mb-1 block text-[13px] font-semibold text-ink-2";
const help = "mt-1 text-xs text-muted";
const primary = "inline-flex h-9 items-center gap-2 rounded-lg bg-brand-navy px-4 text-sm font-semibold text-white hover:bg-navy-deep disabled:opacity-60 dark:bg-navy dark:text-navy-deep";
const secondary = "inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";

const INTERVALS = [
  [0, "Off (manual only)"], [15, "Every 15 minutes"], [30, "Every 30 minutes"], [60, "Every hour"], [120, "Every 2 hours"],
  [360, "Every 6 hours"], [720, "Every 12 hours"], [1440, "Once a day"],
] as const;

export function SettingsForm({ settings, canEdit }: { settings: AppSettings; canEdit: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, {});
  const intervals: (readonly [number, string])[] = INTERVALS.some(([v]) => v === settings.syncIntervalMinutes)
    ? [...INTERVALS]
    : [...INTERVALS, [settings.syncIntervalMinutes, `Every ${settings.syncIntervalMinutes} minutes`] as const];
  return (
    <form action={action} className="space-y-5">
      <fieldset disabled={!canEdit || pending} className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="syncIntervalMinutes" className={label}>Automatic synchronisation</label>
          <select id="syncIntervalMinutes" name="syncIntervalMinutes" defaultValue={settings.syncIntervalMinutes} className={inputClass}>
            {intervals.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <p className={help}>How often Odoo and the attendance app are synchronised in the background.</p>
        </div>
        <div>
          <label htmlFor="lowAttendanceThreshold" className={label}>Low attendance threshold (%)</label>
          <input id="lowAttendanceThreshold" name="lowAttendanceThreshold" type="number" min={1} max={100} step={1} defaultValue={settings.lowAttendanceThreshold} className={inputClass} />
          <p className={help}>Players and coaches below this rate are flagged.</p>
        </div>
        <div>
          <label htmlFor="fuzzySuggestionThreshold" className={label}>Name-similarity for suggestions (%)</label>
          <input id="fuzzySuggestionThreshold" name="fuzzySuggestionThreshold" type="number" min={50} max={99} step={1} defaultValue={Math.round(settings.fuzzySuggestionThreshold * 100)} className={inputClass} />
          <p className={help}>Similar names above this score are proposed for review (never linked automatically).</p>
        </div>
        <div className="flex items-start gap-3 pt-6">
          <input id="autoConfirmExactNames" name="autoConfirmExactNames" type="checkbox" defaultChecked={settings.autoConfirmExactNames} className="mt-0.5 h-4 w-4 accent-[#1b2452]" />
          <label htmlFor="autoConfirmExactNames" className="text-sm text-ink">
            <span className="font-semibold">Auto-link identical, unique names</span>
            <span className="block text-xs text-muted">When a name appears exactly once in both systems. Turn off to review every name match by hand.</span>
          </label>
        </div>
      </fieldset>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className={primary} disabled={pending}>{pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}Save settings</button>
          <Result state={state} />
        </div>
      ) : null}
    </form>
  );
}

export function ConnectionTest({ system }: { system: "odoo" | "bfa" }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={secondary} disabled={pending} onClick={() => start(async () => setState(await (system === "odoo" ? testOdoo() : testBfa())))}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlugZap className="h-4 w-4" aria-hidden />} Test connection
      </button>
      <Result state={state} />
    </div>
  );
}

export function FullResync() {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={secondary}
        disabled={pending}
        onClick={() => { if (confirm("Re-read every invoice, payment and attendance record from both systems? This can take a few minutes.")) start(async () => setState(await startFullResync())); }}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />} Full resynchronisation
      </button>
      <Result state={state} />
    </div>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, {});
  return (
    <form action={action} className="grid max-w-md grid-cols-1 gap-3">
      <div><label htmlFor="current" className={label}>Current password</label><input id="current" name="current" type="password" autoComplete="current-password" required className={inputClass} /></div>
      <div><label htmlFor="next" className={label}>New password</label><input id="next" name="next" type="password" autoComplete="new-password" required minLength={10} className={inputClass} /><p className={help}>At least 10 characters, with letters and numbers.</p></div>
      <div><label htmlFor="confirm" className={label}>Repeat new password</label><input id="confirm" name="confirm" type="password" autoComplete="new-password" required className={inputClass} /></div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={primary}>{pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}Change password</button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function AddUserForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addUser, {});
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-5 md:items-end">
      <div><label htmlFor="u-name" className={label}>Name</label><input id="u-name" name="name" required className={inputClass} /></div>
      <div><label htmlFor="u-email" className={label}>E-mail</label><input id="u-email" name="email" type="email" required className={inputClass} /></div>
      <div><label htmlFor="u-password" className={label}>Temporary password</label><input id="u-password" name="password" type="password" autoComplete="new-password" required minLength={10} className={inputClass} /></div>
      <div>
        <label htmlFor="u-role" className={label}>Role</label>
        <select id="u-role" name="role" className={inputClass} defaultValue="viewer">
          <option value="viewer">Viewer (read-only)</option>
          <option value="admin">Administrator</option>
        </select>
      </div>
      <button type="submit" disabled={pending} className={cn(primary, "justify-center")}>{pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}Add user</button>
      <div className="md:col-span-5"><Result state={state} /></div>
    </form>
  );
}

export function UserActiveToggle({ userId, active }: { userId: number; active: boolean }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" disabled={pending} className={cn(secondary, "h-8 text-[13px]", active && "text-bad")} onClick={() => start(async () => setState(await setUserActive(userId, !active)))}>
        {active ? "Deactivate" : "Reactivate"}
      </button>
      {state.error ? <p className="text-xs text-bad">{state.error}</p> : null}
    </div>
  );
}
