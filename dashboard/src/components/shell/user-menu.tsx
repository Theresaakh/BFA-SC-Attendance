import { LogOut } from "lucide-react";
import { logout } from "@/app/actions/auth";
import type { SessionUser } from "@/lib/auth/session";

export function UserMenu({ user }: { user: SessionUser }) {
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-1 hover:bg-surface-2" aria-label="Account menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-navy text-xs font-bold text-white dark:bg-navy dark:text-navy-deep">{initials}</span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-line bg-surface p-2 shadow-xl">
        <div className="px-3 py-2">
          <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{user.role === "admin" ? "Administrator" : "Viewer"}</p>
        </div>
        <form action={logout}>
          <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
