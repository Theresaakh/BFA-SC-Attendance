import { sql, type SQL } from "drizzle-orm";
import type { Filters } from "../filters";
import { dateRange, likePattern, orderBy, rows, today, where } from "./common";

const rate = (present: string, total: string) =>
  sql.raw(`case when ${total} > 0 then round(100.0 * ${present} / ${total}, 1)::float8 end`);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionRow = {
  id: number;
  date: string;
  team_id: number;
  team_name: string;
  branch_id: number | null;
  branch_name: string | null;
  present: number;
  absent: number;
  rate: number | null;
  coach_name: string | null;
  coach_status: string | null;
  coach_replacement: string | null;
  assistant_name: string | null;
  assistant_status: string | null;
  total: number;
};

function sessionConds(f: Filters): (SQL | undefined)[] {
  return [
    sql`s.deleted_at is null`,
    f.branch ? sql`t.branch_id = ${f.branch}` : undefined,
    f.team ? sql`s.team_id = ${f.team}` : undefined,
    f.coach ? sql`exists (select 1 from coach_attendance_records car where car.session_id = s.id and car.coach_id = ${f.coach} and car.deleted_at is null)` : undefined,
    f.player ? sql`exists (select 1 from attendance_records ar where ar.session_id = s.id and ar.player_id = ${f.player} and ar.deleted_at is null)` : undefined,
    f.from ? sql`s.date >= ${f.from}` : undefined,
    f.to ? sql`s.date <= ${f.to}` : undefined,
    f.q ? sql`t.name ilike ${likePattern(f.q)}` : undefined,
  ];
}

export async function listSessions(f: Filters, opts: { limit?: number | null; offset?: number } = {}) {
  const limit = opts.limit === null ? sql`` : sql`limit ${opts.limit ?? 25} offset ${opts.offset ?? 0}`;
  const result = await rows<SessionRow>(sql`
    select s.id, s.date::text, t.id as team_id, t.name as team_name, b.id as branch_id, b.name as branch_name,
      coalesce(a.present, 0) as present, coalesce(a.absent, 0) as absent,
      ${rate("coalesce(a.present,0)", "(coalesce(a.present,0)+coalesce(a.absent,0))")} as rate,
      cc.name as coach_name, ch.status as coach_status, ch.replacement_name as coach_replacement,
      ac.name as assistant_name, ah.status as assistant_status,
      (count(*) over ())::int as total
    from attendance_sessions s
    join teams t on t.id = s.team_id
    left join branches b on b.id = t.branch_id
    left join lateral (
      select count(*) filter (where ar.status = 'present')::int as present, count(*) filter (where ar.status = 'absent')::int as absent
      from attendance_records ar where ar.session_id = s.id and ar.deleted_at is null
    ) a on true
    left join coach_attendance_records ch on ch.session_id = s.id and ch.role = 'coach' and ch.deleted_at is null
    left join coaches cc on cc.id = ch.coach_id
    left join coach_attendance_records ah on ah.session_id = s.id and ah.role = 'assistant' and ah.deleted_at is null
    left join coaches ac on ac.id = ah.coach_id
    ${where(sessionConds(f))}
    ${orderBy(f.sort, f.dir ?? (f.sort ? "asc" : "desc"), { date: "s.date", team: "t.name", branch: "b.name", rate: "rate" }, "date")}, s.id desc
    ${limit}`);
  return { rows: result, total: result[0]?.total ?? 0 };
}

export type SessionPlayerRow = { player_id: number; name: string; status: "present" | "absent" };

export async function sessionDetail(sessionId: number) {
  const players = await rows<SessionPlayerRow>(sql`
    select p.id as player_id, p.name, ar.status from attendance_records ar join players p on p.id = ar.player_id
    where ar.session_id = ${sessionId} and ar.deleted_at is null order by ar.status desc, p.name`);
  return players;
}

// ---------------------------------------------------------------------------
// Attendance records (player level, filterable by status)
// ---------------------------------------------------------------------------

export type RecordRow = {
  id: number;
  date: string;
  status: "present" | "absent";
  player_id: number;
  player_name: string;
  team_name: string;
  branch_name: string | null;
  total: number;
};

export async function listRecords(f: Filters, opts: { limit?: number | null; offset?: number } = {}) {
  const limit = opts.limit === null ? sql`` : sql`limit ${opts.limit ?? 25} offset ${opts.offset ?? 0}`;
  const result = await rows<RecordRow>(sql`
    select ar.id, s.date::text, ar.status, p.id as player_id, p.name as player_name, t.name as team_name, b.name as branch_name,
      (count(*) over ())::int as total
    from attendance_records ar
    join attendance_sessions s on s.id = ar.session_id
    join players p on p.id = ar.player_id
    join teams t on t.id = s.team_id
    left join branches b on b.id = t.branch_id
    ${where([
      sql`ar.deleted_at is null and s.deleted_at is null`,
      f.attendanceStatus ? sql`ar.status = ${f.attendanceStatus}` : undefined,
      f.branch ? sql`t.branch_id = ${f.branch}` : undefined,
      f.team ? sql`s.team_id = ${f.team}` : undefined,
      f.player ? sql`p.id = ${f.player}` : undefined,
      f.coach ? sql`s.team_id in (select team_id from team_coaches where coach_id = ${f.coach})` : undefined,
      f.from ? sql`s.date >= ${f.from}` : undefined,
      f.to ? sql`s.date <= ${f.to}` : undefined,
      f.q ? sql`p.name ilike ${likePattern(f.q)}` : undefined,
    ])}
    order by s.date desc, p.name
    ${limit}`);
  return { rows: result, total: result[0]?.total ?? 0 };
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export type GroupRate = { id: number; name: string; branch_name?: string | null; players: number; sessions: number; present: number; absent: number; rate: number | null };

export async function attendanceByTeam(f: Filters): Promise<GroupRate[]> {
  return rows<GroupRate>(sql`
    select t.id, t.name, b.name as branch_name,
      (select count(*)::int from players p where p.team_id = t.id and p.deleted_at is null) as players,
      count(distinct s.id)::int as sessions,
      count(ar.id) filter (where ar.status = 'present')::int as present,
      count(ar.id) filter (where ar.status = 'absent')::int as absent,
      ${rate("count(ar.id) filter (where ar.status = 'present')", "count(ar.id)")} as rate
    from teams t
    left join branches b on b.id = t.branch_id
    left join attendance_sessions s on s.team_id = t.id and s.deleted_at is null ${dateRange(sql`s.date`, f.from, f.to)}
    left join attendance_records ar on ar.session_id = s.id and ar.deleted_at is null
    where t.deleted_at is null
      ${f.branch ? sql`and t.branch_id = ${f.branch}` : sql``}
      ${f.team ? sql`and t.id = ${f.team}` : sql``}
      ${f.coach ? sql`and t.id in (select team_id from team_coaches where coach_id = ${f.coach})` : sql``}
    group by t.id, t.name, b.name
    order by b.name nulls last, t.name`);
}

export async function attendanceByBranch(f: Filters): Promise<GroupRate[]> {
  return rows<GroupRate>(sql`
    select b.id, b.name,
      (select count(*)::int from players p where p.branch_id = b.id and p.deleted_at is null) as players,
      count(distinct s.id)::int as sessions,
      count(ar.id) filter (where ar.status = 'present')::int as present,
      count(ar.id) filter (where ar.status = 'absent')::int as absent,
      ${rate("count(ar.id) filter (where ar.status = 'present')", "count(ar.id)")} as rate
    from branches b
    left join teams t on t.branch_id = b.id and t.deleted_at is null
    left join attendance_sessions s on s.team_id = t.id and s.deleted_at is null ${dateRange(sql`s.date`, f.from, f.to)}
    left join attendance_records ar on ar.session_id = s.id and ar.deleted_at is null
    where b.deleted_at is null ${f.branch ? sql`and b.id = ${f.branch}` : sql``}
    group by b.id, b.name
    order by b.name`);
}

export type AttendanceTotals = {
  sessions: number;
  player_present: number;
  player_absent: number;
  player_rate: number | null;
  coach_present: number;
  coach_absent: number;
  coach_rate: number | null;
};

export async function attendanceTotals(f: Filters): Promise<AttendanceTotals> {
  const [row] = await rows<AttendanceTotals>(sql`
    with s as (
      select s.id from attendance_sessions s join teams t on t.id = s.team_id
      where s.deleted_at is null ${dateRange(sql`s.date`, f.from, f.to)}
        ${f.branch ? sql`and t.branch_id = ${f.branch}` : sql``} ${f.team ? sql`and t.id = ${f.team}` : sql``}
    ), pa as (
      select count(*) filter (where status = 'present')::int as present, count(*) filter (where status = 'absent')::int as absent
      from attendance_records where deleted_at is null and session_id in (select id from s)
    ), ca as (
      select count(*) filter (where status = 'present')::int as present, count(*) filter (where status = 'absent')::int as absent
      from coach_attendance_records where deleted_at is null and session_id in (select id from s)
    )
    select (select count(*)::int from s) as sessions,
      pa.present as player_present, pa.absent as player_absent, ${rate("pa.present", "(pa.present + pa.absent)")} as player_rate,
      ca.present as coach_present, ca.absent as coach_absent, ${rate("ca.present", "(ca.present + ca.absent)")} as coach_rate
    from pa, ca`);
  return row;
}

export type WeeklyRate = { week: string; player_rate: number | null; coach_rate: number | null; sessions: number };

export async function weeklyAttendance(weeks = 12, f: Filters = {}): Promise<WeeklyRate[]> {
  return rows<WeeklyRate>(sql`
    with w as (
      select generate_series(date_trunc('week', ${today()}) - make_interval(weeks => ${weeks - 1}), date_trunc('week', ${today()}), interval '1 week')::date as week
    ), s as (
      select s.id, date_trunc('week', s.date)::date as week from attendance_sessions s join teams t on t.id = s.team_id
      where s.deleted_at is null ${f.branch ? sql`and t.branch_id = ${f.branch}` : sql``} ${f.team ? sql`and t.id = ${f.team}` : sql``}
    ), pr as (
      select s.week, count(*) filter (where ar.status = 'present')::int as present, count(ar.id)::int as total, count(distinct s.id)::int as sessions
      from s join attendance_records ar on ar.session_id = s.id and ar.deleted_at is null group by s.week
    ), cr as (
      select s.week, count(*) filter (where c.status = 'present')::int as present, count(c.id)::int as total
      from s join coach_attendance_records c on c.session_id = s.id and c.deleted_at is null group by s.week
    )
    select w.week::text as week,
      ${rate("pr.present", "pr.total")} as player_rate,
      ${rate("cr.present", "cr.total")} as coach_rate,
      coalesce(pr.sessions, 0) as sessions
    from w left join pr using (week) left join cr using (week)
    order by w.week`);
}
