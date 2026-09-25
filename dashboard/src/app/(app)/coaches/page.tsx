import Link from "next/link";
import { UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { PAGE_SIZE, parseFilters, toQuery, type RawSearchParams } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { listCoaches } from "@/lib/queries/coaches";
import { attendanceTotals } from "@/lib/queries/attendance";
import { lookups } from "@/lib/queries/lookups";
import { Card } from "@/components/ui/card";
import { EmptyRow, SortTh, Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Pagination, RateBar, StatCard } from "@/components/ui/misc";
import { FilterBar, optionsFrom } from "@/components/filter-bar";
import { ExportButtons } from "@/components/export-menu";
import { formatNumber, formatPct } from "@/lib/format";

export const metadata = { title: "Coaches" };

export default async function CoachesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUser();
  const f = parseFilters(await searchParams);
  const page = f.page ?? 1;
  const [settings, look, data, totals] = await Promise.all([
    getSettings(),
    lookups(),
    listCoaches(f, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    attendanceTotals(f),
  ]);
  const threshold = settings.lowAttendanceThreshold;
  const sortHref = (sort: string, dir: "asc" | "desc") => `/coaches${toQuery({ ...f, page: undefined }, { sort, dir })}`;
  return (
    <>
      <PageHeader title="Coaches" subtitle="Head coach and assistant attendance recorded at each session" actions={<ExportButtons report="coach-attendance" query={toQuery({ ...f, page: undefined })} />} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Coach attendance" value={formatPct(totals.coach_rate, 1)} tone={totals.coach_rate !== null && totals.coach_rate < threshold ? "bad" : "default"} />
        <StatCard label="Sessions attended" value={formatNumber(totals.coach_present)} tone="good" />
        <StatCard label="Sessions missed" value={formatNumber(totals.coach_absent)} tone={totals.coach_absent ? "bad" : "default"} />
        <StatCard label="Coaches" value={formatNumber(data.total)} />
      </div>
      <FilterBar
        action="/coaches"
        filters={f}
        primary={[
          { name: "q", label: "Search", type: "search", placeholder: "Coach name" },
          { name: "coach", label: "Coach", type: "select", options: optionsFrom(look.coaches) },
          { name: "branch", label: "Branch", type: "select", options: optionsFrom(look.branches) },
          { name: "team", label: "Team", type: "select", options: optionsFrom(look.teams) },
        ]}
        more={[
          { name: "from", label: "From date", type: "date" },
          { name: "to", label: "To date", type: "date" },
          { name: "attMax", label: "Attendance below (%)", type: "number" },
          { name: "attMin", label: "Attendance at least (%)", type: "number" },
        ]}
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <SortTh label="Coach" sortKey="name" current={f.sort} dir={f.dir} hrefFor={sortHref} />
              <Th>Teams</Th>
              <Th>Branch</Th>
              <SortTh label="Sessions" sortKey="sessions" current={f.sort} dir={f.dir} hrefFor={sortHref} className="text-right" />
              <Th className="text-right">Attended</Th>
              <Th className="text-right">Missed</Th>
              <SortTh label="Attendance" sortKey="rate" current={f.sort} dir={f.dir} hrefFor={sortHref} />
              <SortTh label="Last session" sortKey="last" current={f.sort} dir={f.dir} hrefFor={sortHref} />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((c) => (
              <Tr key={c.id}>
                <Td><Link href={`/coaches/${c.id}${toQuery({ from: f.from, to: f.to })}`} className="font-semibold hover:underline">{c.name}</Link></Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {c.teams?.map((t) => <Badge key={`${t.id}-${t.role}`} tone={t.role === "coach" ? "navy" : "gray"} dot={false}>{t.name}{t.role === "assistant" ? " (asst.)" : ""}</Badge>) ?? <span className="text-muted">No current team</span>}
                  </div>
                </Td>
                <Td className="text-ink-2">{c.branches?.join(", ") ?? "—"}</Td>
                <Td className="text-right tabular">{c.sessions}</Td>
                <Td className="text-right tabular text-good">{c.present}</Td>
                <Td className="text-right tabular text-bad">{c.absent}</Td>
                <Td><RateBar rate={c.rate} threshold={threshold} /></Td>
                <Td className="whitespace-nowrap tabular text-ink-2">{formatDate(c.last_session)}</Td>
              </Tr>
            ))}
            {!data.rows.length ? (
              <EmptyRow colSpan={8}><UserRound className="mx-auto mb-2 h-6 w-6" aria-hidden />No coaches match these filters.</EmptyRow>
            ) : null}
          </tbody>
        </Table>
        <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} hrefFor={(pg) => `/coaches${toQuery(f, { page: pg })}`} />
      </Card>
    </>
  );
}
