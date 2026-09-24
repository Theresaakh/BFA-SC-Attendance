import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { formatDateTime, timeAgo } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getSyncOverview } from "@/lib/sync/runner";
import { listSyncRuns } from "@/lib/queries/sync";
import { Card } from "@/components/ui/card";
import { EmptyRow, Table, Td, Th, Tr } from "@/components/ui/table";
import { PageHeader, Pagination, StatCard } from "@/components/ui/misc";
import { SOURCE_LABEL, SyncStatusBadge, TRIGGER_LABEL } from "@/components/sync-status-badge";
import type { RawSearchParams } from "@/lib/filters";

export const metadata = { title: "Sync logs" };
const PAGE = 30;

function duration(a: Date, b: Date | null) {
  if (!b) return "—";
  const s = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function SyncPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Math.min(10000, Number(sp.page) || 1));
  const [overview, settings, { runs, total }] = await Promise.all([getSyncOverview(), getSettings(), listSyncRuns(page, PAGE)]);
  const odoo = overview.sources.find((s) => s.source === "odoo");
  const bfa = overview.sources.find((s) => s.source === "bfa");
  return (
    <>
      <PageHeader title="Sync logs" subtitle="Every synchronisation with Odoo and the BFA attendance app, with its results and errors" />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Odoo · last success" value={timeAgo(odoo?.lastSuccessAt)} hint={odoo?.lastSuccessAt ? formatDateTime(odoo.lastSuccessAt) : "Never synchronised"} tone={odoo?.lastRun?.status === "failed" ? "bad" : "default"} />
        <StatCard label="Attendance · last success" value={timeAgo(bfa?.lastSuccessAt)} hint={bfa?.lastSuccessAt ? formatDateTime(bfa.lastSuccessAt) : "Never synchronised"} tone={bfa?.lastRun?.status === "failed" ? "bad" : "default"} />
        <StatCard label="Automatic sync" value={settings.syncIntervalMinutes ? `Every ${settings.syncIntervalMinutes} min` : "Off"} hint="Change in Settings" href="/settings" />
      </div>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Started</Th><Th>Source</Th><Th>Trigger</Th><Th>Status</Th>
              <Th className="text-right">Processed</Th><Th className="text-right">Added</Th><Th className="text-right">Updated</Th>
              <Th className="text-right">Skipped</Th><Th className="text-right">Deleted</Th><Th className="text-right">Errors</Th><Th>Duration</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map(({ run, userName }) => (
              <Tr key={run.id}>
                <Td className="whitespace-nowrap"><Link href={`/sync/${run.id}`} className="font-semibold hover:underline">{formatDateTime(run.startedAt)}</Link></Td>
                <Td className="whitespace-nowrap">{SOURCE_LABEL[run.source]}</Td>
                <Td className="whitespace-nowrap text-ink-2">{TRIGGER_LABEL[run.trigger]}{userName ? <span className="block text-xs text-muted">{userName}</span> : null}</Td>
                <Td><SyncStatusBadge status={run.status} />{run.status === "failed" && run.message ? <p className="mt-1 max-w-xs truncate text-xs text-bad" title={run.message}>{run.message}</p> : null}</Td>
                <Td className="text-right tabular">{run.processed}</Td>
                <Td className="text-right tabular">{run.added}</Td>
                <Td className="text-right tabular">{run.updated}</Td>
                <Td className="text-right tabular">{run.skipped}</Td>
                <Td className="text-right tabular">{run.deleted}</Td>
                <Td className={`text-right tabular ${run.errorCount ? "font-semibold text-bad" : ""}`}>{run.errorCount}</Td>
                <Td className="whitespace-nowrap tabular text-ink-2">{duration(run.startedAt, run.finishedAt)}</Td>
              </Tr>
            ))}
            {!runs.length ? <EmptyRow colSpan={11}><RefreshCw className="mx-auto mb-2 h-6 w-6" aria-hidden />No synchronisation has run yet.</EmptyRow> : null}
          </tbody>
        </Table>
        <Pagination page={page} total={total} pageSize={PAGE} hrefFor={(p) => `/sync?page=${p}`} />
      </Card>
    </>
  );
}
