import { sql } from "drizzle-orm";
import type { Filters } from "../filters";
import { dateRange, likePattern, orderBy, rows, where } from "./common";

export type CoachRow = {
  id: number;
  name: string;
  teams: { id: number; name: string; role: string }[] | null;
  branches: string[] | null;
  sessions: number;
  present: number;
  absent: number;
  rate: number | null;
  last_session: string | null;
  total: number;
};

const SORTS: Record<string, string> = { name: "name", sessions: "sessions", rate: "rate", last: "last_session" };

export async function listCoaches(f: Filters, opts: { limit?: number | null; offset?: number } = {}) {
  const limit = opts.limit === null ? sql`` : sql`limit ${opts.limit ?? 25} offset ${opts.offset ?? 0}`;
  const result = await rows<CoachRow>(sql`
    with rec as (
      select car.coach_id,
        count(*)::int as sessions,
        count(*) filter (where car.status = 'present')::int as present,
        count(*) filter (where car.status = 'absent')::int as absent,
        max(s.date)::text as last_session
      from coach_attendance_records car
      join attendance_sessions s on s.id = car.session_id and s.deleted_at is null
      join teams t on t.id = s.team_id
      where car.deleted_at is null ${dateRange(sql`s.date`, f.from, f.to)}
        ${f.team ? sql`and s.team_id = ${f.team}` : sql``}
        ${f.branch ? sql`and t.branch_id = ${f.branch}` : sql``}
      group by car.coach_id
    ), base as (
      select c.id, c.name,
        (select json_agg(json_build_object('id', t.id, 'name', t.name, 'role', tc.role) order by t.name)
          from team_coaches tc join teams t on t.id = tc.team_id and t.deleted_at is null where tc.coach_id = c.id) as teams,
        (select array_agg(distinct b.name) from team_coaches tc join teams t on t.id = tc.team_id and t.deleted_at is null
          join branches b on b.id = t.branch_id where tc.coach_id = c.id) as branches,
        coalesce(rec.sessions, 0) as sessions, coalesce(rec.present, 0) as present, coalesce(rec.absent, 0) as absent,
        case when rec.sessions > 0 then round(100.0 * rec.present / rec.sessions, 1)::float8 end as rate,
        rec.last_session
      from coaches c left join rec on rec.coach_id = c.id
      where c.deleted_at is null
    )
    select *, (count(*) over ())::int as total from base
    ${where([
      f.q ? sql`name ilike ${likePattern(f.q)}` : undefined,
      f.coach ? sql`id = ${f.coach}` : undefined,
      f.team ? sql`(id in (select coach_id from team_coaches where team_id = ${f.team}) or sessions > 0)` : undefined,
      f.branch ? sql`(id in (select tc.coach_id from team_coaches tc join teams t on t.id = tc.team_id where t.branch_id = ${f.branch}) or sessions > 0)` : undefined,
      f.attMin !== undefined ? sql`rate >= ${f.attMin}` : undefined,
      f.attMax !== undefined ? sql`rate < ${f.attMax}` : undefined,
    ])}
    ${orderBy(f.sort, f.dir ?? (f.sort ? "asc" : "asc"), SORTS, "name")}, id
    ${limit}`);
  return { rows: result, total: result[0]?.total ?? 0 };
}

export type CoachHistoryRow = { date: string; team_id: number; team_name: string; branch_name: string | null; role: string; status: string; replacement_name: string | null };

export async function coachHistory(coachId: number, f: Filters = {}) {
  return rows<CoachHistoryRow>(sql`
    select s.date::text, t.id as team_id, t.name as team_name, b.name as branch_name, car.role, car.status, car.replacement_name
    from coach_attendance_records car
    join attendance_sessions s on s.id = car.session_id and s.deleted_at is null
    join teams t on t.id = s.team_id
    left join branches b on b.id = t.branch_id
    where car.coach_id = ${coachId} and car.deleted_at is null ${dateRange(sql`s.date`, f.from, f.to)}
      ${f.team ? sql`and t.id = ${f.team}` : sql``}
    order by s.date desc`);
}
