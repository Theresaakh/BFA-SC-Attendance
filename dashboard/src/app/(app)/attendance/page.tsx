import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { PAGE_SIZE, parseFilters, toQuery, type RawSearchParams } from "@/lib/filters";
import { formatDate, formatNumber, formatPct } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { attendanceByBranch, attendanceByTeam, attendanceTotals, listRecords, listSessions, type GroupRate } from "@/lib/queries/attendance";
import { lookups } from "@/lib/queries/lookups";
import { Card } from "@/components/ui/card";
import { EmptyRow, SortTh, Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Pagination, RateBar, StatCard, Tabs } from "@/components/ui/misc";
import { FilterBar, optionsFrom, type FilterField } from "@/components/filter-bar";
import { ExportButtons } from "@/components/export-menu";

export const metadata = { title: "Attendance" };

const TABS = ["sessions", "records", "teams", "branches"] as const;
type Tab = (typeof TABS)[number];

export default async function AttendancePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "sessions";
  const f = parseFilters(sp);
  const page = f.page ?? 1;
  const [settings, look, totals] = await Promise.all([getSettings(), lookups(), attendanceTotals(f)]);
  const threshold = settings.lowAttendanceThreshold;
  const q = (extra: Record<string, string | number | undefined> = {}) => toQuery({ ...f, page: undefined, tab }, extra);

  const primary: FilterField[] = [
    { name: "branch", label: "Branch", type: "select", options: optionsFrom(look.branches) },
    { name: "team", label: "Team", type: "select", options: optionsFrom(look.teams) },
    { name: "from", label: "From date", type: "date" },
    { name: "to", label: "To date", type: "date" },
  ];
  if (tab === "records") {
    primary.unshift({ name: "q", label: "Player", type: "search", placeholder: "Player name" });
    primary.push({ name: "attendanceStatus", label: "Attendance status", type: "select", options: [{ value: "present", label: "Present" }, { value: "absent", label: "Absent" }] });
  }
  if (tab === "sessions") primary.push({ name: "coach", label: "Coach", type: "select", options: optionsFrom(look.coaches) });

  const report = tab === "teams" ? "team-attendance" : tab === "branches" ? "branch-attendance" : tab === "records" ? "attendance-records" : "sessions";

  return (
    <>
      <PageHeader title="Attendance" subtitle="Training sessions recorded in the BFA attendance app" actions={<ExportButtons report={report} query={toQuery({ ...f, page: undefined })} />} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Sessions" value={formatNumber(totals.sessions)} />
        <StatCard label="Player attendance" value={formatPct(totals.player_rate, 1)} tone={totals.player_rate !== null && totals.player_rate < threshold ? "bad" : "default"} hint={`${formatNumber(totals.player_present)} present · ${formatNumber(totals.player_absent)} absent`} />
        <StatCard label="Coach attendance" value={formatPct(totals.coach_rate, 1)} tone={totals.coach_rate !== null && totals.coach_rate < threshold ? "bad" : "default"} hint={`${formatNumber(totals.coach_present)} present · ${formatNumber(totals.coach_absent)} absent`} />
        <StatCard label="Absences" value={formatNumber(totals.player_absent)} href={`/attendance${toQuery({ ...f, page: undefined, tab: "records", attendanceStatus: "absent" })}`} />
      </div>
      <Tabs
        active={tab}
        items={[
          { key: "sessions", label: "Sessions", href: `/attendance${toQuery({ ...f, page: undefined, tab: "sessions" })}` },
          { key: "records", label: "Player records", href: `/attendance${toQuery({ ...f, page: undefined, tab: "records" })}` },
          { key: "teams", label: "By team", href: `/attendance${toQuery({ ...f, page: undefined, tab: "teams" })}` },
          { key: "branches", label: "By branch", href: `/attendance${toQuery({ ...f, page: undefined, tab: "branches" })}` },
        ]}
      />
      <FilterBar action="/attendance" filters={f} primary={primary} hidden={{ tab }} />
      {tab === "sessions" ? <Sessions f={f} page={page} threshold={threshold} q={q} /> : null}
      {tab === "records" ? <Records f={f} page={page} /> : null}
      {tab === "teams" ? <Groups rows={await attendanceByTeam(f)} threshold={threshold} kind="team" /> : null}
      {tab === "branches" ? <Groups rows={await attendanceByBranch(f)} threshold={threshold} kind="branch" /> : null}
    </>
  );
}

async function Sessions({ f, page, threshold, q }: { f: ReturnType<typeof parseFilters>; page: number; threshold: number; q: (e?: Record<string, string | number | undefined>) => string }) {
  const data = await listSessions(f, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const sortHref = (sort: string, dir: "asc" | "desc") => `/attendance${q({ sort, dir })}`;
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <SortTh label="Date" sortKey="date" current={f.sort} dir={f.dir} hrefFor={sortHref} />
            <SortTh label="Team" sortKey="team" current={f.sort} dir={f.dir} hrefFor={sortHref} />
            <SortTh label="Branch" sortKey="branch" current={f.sort} dir={f.dir} hrefFor={sortHref} />
            <Th className="text-right">Present</Th>
            <SortTh label="Attendance" sortKey="rate" current={f.sort} dir={f.dir} hrefFor={sortHref} />
            <Th>Coach</Th>
            <Th>Assistant</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((s) => (
            <Tr key={s.id}>
              <Td className="whitespace-nowrap font-semibold tabular">{formatDate(s.date)}</Td>
              <Td><Link href={`/players?team=${s.team_id}`} className="hover:underline">{s.team_name}</Link></Td>
              <Td className="text-ink-2">{s.branch_name ?? "—"}</Td>
              <Td className="text-right tabular">{s.present}/{s.present + s.absent}</Td>
              <Td><RateBar rate={s.rate} threshold={threshold} /></Td>
              <Td><StaffCell name={s.coach_name} status={s.coach_status} replacement={s.coach_replacement} /></Td>
              <Td><StaffCell name={s.assistant_name} status={s.assistant_status} /></Td>
            </Tr>
          ))}
          {!data.rows.length ? <EmptyRow colSpan={7}><CalendarCheck className="mx-auto mb-2 h-6 w-6" aria-hidden />No sessions match these filters.</EmptyRow> : null}
        </tbody>
      </Table>
      <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} hrefFor={(pg) => `/attendance${q({ page: pg })}`} />
    </Card>
  );
}

function StaffCell({ name, status, replacement }: { name: string | null; status: string | null; replacement?: string | null }) {
  if (!status) return <span className="text-xs text-muted">Not recorded</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <Badge tone={status === "present" ? "green" : "red"}>{status === "present" ? "Present" : "Absent"}</Badge>
      {name ? <span className="text-xs text-muted">{name}</span> : null}
      {replacement ? <span className="text-xs text-muted">Replaced by {replacement}</span> : null}
    </div>
  );
}

async function Records({ f, page }: { f: ReturnType<typeof parseFilters>; page: number }) {
  const data = await listRecords(f, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  return (
    <Card>
      <Table>
        <thead>
          <tr><Th>Date</Th><Th>Player</Th><Th>Team</Th><Th>Branch</Th><Th>Status</Th></tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <Tr key={r.id}>
              <Td className="whitespace-nowrap tabular">{formatDate(r.date)}</Td>
              <Td><Link href={`/players/${r.player_id}`} className="font-semibold hover:underline">{r.player_name}</Link></Td>
              <Td className="text-ink-2">{r.team_name}</Td>
              <Td className="text-ink-2">{r.branch_name ?? "—"}</Td>
              <Td><Badge tone={r.status === "present" ? "green" : "red"}>{r.status === "present" ? "Present" : "Absent"}</Badge></Td>
            </Tr>
          ))}
          {!data.rows.length ? <EmptyRow colSpan={5}>No attendance records match these filters.</EmptyRow> : null}
        </tbody>
      </Table>
      <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} hrefFor={(pg) => `/attendance${toQuery({ ...f, tab: "records" }, { page: pg })}`} />
    </Card>
  );
}

function Groups({ rows, threshold, kind }: { rows: GroupRate[]; threshold: number; kind: "team" | "branch" }) {
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>{kind === "team" ? "Team" : "Branch"}</Th>
            {kind === "team" ? <Th>Branch</Th> : null}
            <Th className="text-right">Players</Th>
            <Th className="text-right">Sessions</Th>
            <Th className="text-right">Present</Th>
            <Th className="text-right">Absent</Th>
            <Th>Attendance</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td><Link href={`/players?${kind}=${r.id}`} className="font-semibold hover:underline">{r.name}</Link></Td>
              {kind === "team" ? <Td className="text-ink-2">{r.branch_name ?? "—"}</Td> : null}
              <Td className="text-right tabular">{r.players}</Td>
              <Td className="text-right tabular">{r.sessions}</Td>
              <Td className="text-right tabular text-good">{r.present}</Td>
              <Td className="text-right tabular text-bad">{r.absent}</Td>
              <Td className="min-w-[180px]"><RateBar rate={r.rate} threshold={threshold} /></Td>
            </Tr>
          ))}
          {!rows.length ? <EmptyRow colSpan={7}>No data for these filters.</EmptyRow> : null}
        </tbody>
      </Table>
    </Card>
  );
}
