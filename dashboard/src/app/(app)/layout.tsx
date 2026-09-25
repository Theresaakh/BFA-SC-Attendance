import { requireUser } from "@/lib/auth/guard";
import { getSyncOverview } from "@/lib/sync/runner";
import { matchingCounts } from "@/lib/queries/matching";
import { Sidebar, MobileNav } from "@/components/shell/sidebar";
import { GlobalSearch } from "@/components/shell/global-search";
import { SyncButton } from "@/components/shell/sync-button";
import { UserMenu } from "@/components/shell/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [sync, counts] = await Promise.all([getSyncOverview(), matchingCounts()]);
  const badges = { "/matching": counts.suggestions };
  const initial = {
    running: sync.running,
    lastSuccessAt: sync.lastSuccessAt?.toISOString() ?? null,
    sources: sync.sources.map((s) => ({
      source: s.source,
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      lastRun: s.lastRun ? { status: s.lastRun.status, message: s.lastRun.message, startedAt: s.lastRun.startedAt.toISOString() } : null,
    })),
  };
  return (
    <div className="min-h-screen">
      <Sidebar badges={badges} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <MobileNav badges={badges} />
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <SyncButton initial={initial} canSync={user.role === "admin"} />
              <UserMenu user={user} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
