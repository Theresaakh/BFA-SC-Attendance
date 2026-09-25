import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { parseFilters, toQuery, type RawSearchParams } from "@/lib/filters";
import { formatDate, formatPct } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { coachHistory, listCoaches } from "@/lib/queries/coaches";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, Table, Td, Th, Tr } from "@/components/ui/table";
import { RateBar, StatCard } from "@/components/ui/misc";
import { FilterBar } from "@/components/filter-bar";
import { ExportButtons } from "@/components/export-menu";

export const metadata = { title: "Coach" };

export default async function CoachPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const f = parseFilters(await searchParams);
  const [settings, list, history] = await Promise.all([
    getSettings(),
    listCoaches({ coach: id, from: f.from, to: f.to, team: f.team }, { limit: 1 }),
    coachHistory(id, f),
  ]);
  const c = list.rows[0];
  if (!c) notFound();
  const threshold = settings.lowAttendanceThreshold;
  const teamOptions = (c.teams ?? []).map((t) => ({ value: t.id, label: t.name }));
  for (const h of history) if (!teamOptions.some((o) => o.value === h.team_id)) teamOptions.push({ value: h.team_id, label: h.team_name });
  return (
    <>
      <Link href="/coaches" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Coaches
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-ink">{c.name}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.teams?.map((t) => <Badge key={`${t.id}-${t.role}`} tone={t.role === "coach" ? "navy" : "gray"} dot={false}>{t.name}{t.role === "assistant" ? " (assistant)" : ""}</Badge>)}
            {c.branches?.length ? <span className="text-sm text-ink-2">{c.branches.join(", ")}</span> : null}
          </div>
        </div>
        <ExportButtons report="coach-attendance" query={toQuery({ coach: id, from: f.from, to: f.to, team: f.team })} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Total sessions" value={String(c.sessions)} />
        <StatCard label="Attended" value={String(c.present)} tone="good" />
        <StatCard label="Missed" value={String(c.absent)} tone={c.absent ? "bad" : "default"} />
        <StatCard label="Attendance" value={formatPct(c.rate, 1)} tone={c.rate !== null && c.rate < threshold ? "bad" : "default"} />
      </div>
      <FilterBar
        action={`/coaches/${id}`}
        filters={f}
        primary={[
          { name: "team", label: "Team", type: "select", options: teamOptions },
          { name: "from", label: "From date", type: "date" },
          { name: "to", label: "To date", type: "date" },
        ]}
      />
      <Card>
        <CardHeader title="Attendance history" subtitle={`${history.length} recorded session(s)`} />
        <CardBody className="pb-2 pt-4"><RateBar rate={c.rate} threshold={threshold} /></CardBody>
        <Table>
          <thead>
            <tr><Th>Date</Th><Th>Team</Th><Th>Branch</Th><Th>Role</Th><Th>Status</Th><Th>Replaced by</Th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <Tr key={`${h.date}-${h.team_id}-${h.role}`}>
                <Td className="whitespace-nowrap tabular">{formatDate(h.date)}</Td>
                <Td>{h.team_name}</Td>
                <Td className="text-ink-2">{h.branch_name ?? "—"}</Td>
                <Td className="capitalize text-ink-2">{h.role}</Td>
                <Td><Badge tone={h.status === "present" ? "green" : "red"}>{h.status === "present" ? "Present" : "Absent"}</Badge></Td>
                <Td className="text-ink-2">{h.replacement_name ?? "—"}</Td>
              </Tr>
            ))}
            {!history.length ? <EmptyRow colSpan={6}>No attendance recorded for this coach in this period.</EmptyRow> : null}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
