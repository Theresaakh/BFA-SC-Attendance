import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { formatDateTime } from "@/lib/format";
import { syncRunDetail } from "@/lib/queries/sync";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyRow, Table, Td, Th, Tr } from "@/components/ui/table";
import { Alert, KeyValue, StatCard } from "@/components/ui/misc";
import { SOURCE_LABEL, SyncStatusBadge, TRIGGER_LABEL } from "@/components/sync-status-badge";

export const metadata = { title: "Sync run" };

export default async function SyncRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = await syncRunDetail(id);
  if (!detail) notFound();
  const { run, errors } = detail;
  return (
    <>
      <Link href="/sync" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Sync logs
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide text-ink">{SOURCE_LABEL[run.source]} · run #{run.id}</h1>
        <SyncStatusBadge status={run.status} />
      </div>
      {run.message ? <div className="mb-5"><Alert tone={run.status === "failed" ? "error" : run.status === "partial" ? "warn" : "info"}>{run.message}</Alert></div> : null}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Processed" value={String(run.processed)} />
        <StatCard label="Added" value={String(run.added)} />
        <StatCard label="Updated" value={String(run.updated)} />
        <StatCard label="Skipped" value={String(run.skipped)} />
        <StatCard label="Deleted" value={String(run.deleted)} />
        <StatCard label="Errors" value={String(run.errorCount)} tone={run.errorCount ? "bad" : "default"} />
      </div>
      <Card className="mb-4">
        <CardHeader title="Run details" />
        <CardBody>
          <KeyValue items={[
            { label: "Started", value: formatDateTime(run.startedAt) },
            { label: "Finished", value: run.finishedAt ? formatDateTime(run.finishedAt) : "Still running" },
            { label: "Trigger", value: TRIGGER_LABEL[run.trigger] },
            { label: "Source", value: SOURCE_LABEL[run.source] },
          ]} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Errors and warnings" subtitle={errors.length >= 500 ? "Showing the first 500" : `${errors.length} logged`} />
        <Table>
          <thead><tr><Th>Record type</Th><Th>Record</Th><Th>Message</Th><Th>Details</Th></tr></thead>
          <tbody>
            {errors.map((e) => (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap text-ink-2">{e.entityType ?? "—"}</Td>
                <Td className="whitespace-nowrap"><code className="text-xs">{e.externalId ?? "—"}</code></Td>
                <Td className="text-bad">{e.message}</Td>
                <Td>{e.details ? <code className="block max-w-md whitespace-pre-wrap break-all text-xs text-muted">{JSON.stringify(e.details)}</code> : "—"}</Td>
              </Tr>
            ))}
            {!errors.length ? <EmptyRow colSpan={4}>No errors in this run.</EmptyRow> : null}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
