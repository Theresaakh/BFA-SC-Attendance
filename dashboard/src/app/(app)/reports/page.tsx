import { sql } from "drizzle-orm";
import { BarChart3, CalendarCheck, FileSpreadsheet, FileText, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { REPORTS, type ReportDef } from "@/lib/reports/definitions";
import { lookups, type Lookups } from "@/lib/queries/lookups";
import { rows } from "@/lib/queries/common";
import { PageHeader } from "@/components/ui/misc";
import { inputClass } from "@/components/filter-bar";

export const metadata = { title: "Reports" };

const ICONS = { Financial: Wallet, Attendance: CalendarCheck, Combined: BarChart3 } as const;

export default async function ReportsPage() {
  await requireUser();
  const [look, settings, players] = await Promise.all([
    lookups(),
    getSettings(),
    rows<{ id: number; name: string; team: string | null }>(sql`
      select p.id, p.name, t.name as team from players p left join teams t on t.id = p.team_id where p.deleted_at is null order by p.name`),
  ]);
  const categories = ["Financial", "Attendance", "Combined"] as const;
  return (
    <>
      <PageHeader title="Reports" subtitle="Choose filters and download any report as Excel or PDF. Every list page also has its own export buttons." />
      <div className="space-y-8">
        {categories.map((cat) => {
          const Icon = ICONS[cat];
          return (
            <section key={cat}>
              <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                <Icon className="h-4 w-4" aria-hidden /> {cat} reports
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {REPORTS.filter((r) => r.category === cat).map((r) => (
                  <ReportCard key={r.id} def={r} look={look} threshold={settings.lowAttendanceThreshold} players={players} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function ReportCard({ def, look, threshold, players }: { def: ReportDef; look: Lookups; threshold: number; players: { id: number; name: string; team: string | null }[] }) {
  const id = (n: string) => `${def.id}-${n}`;
  const lbl = "mb-1 block text-[12px] font-semibold text-muted";
  return (
    <form action={`/api/reports/${def.id}`} method="get" className="flex flex-col rounded-xl border border-line bg-surface p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-ink">{def.title}</h3>
        <p className="mt-0.5 text-[13px] text-muted">{def.description}</p>
      </div>
      <div className="grid flex-1 grid-cols-2 content-start gap-3">
        {def.filters.includes("player") ? (
          <div className="col-span-2">
            <label className={lbl} htmlFor={id("player")}>Player</label>
            <select id={id("player")} name="player" className={inputClass} required={def.id === "player-profile"} defaultValue="">
              <option value="">{def.id === "player-profile" ? "Choose a player…" : "All players"}</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.name}{p.team ? ` — ${p.team}` : ""}</option>)}
            </select>
          </div>
        ) : null}
        {def.filters.includes("date") ? (
          <>
            <div><label className={lbl} htmlFor={id("from")}>From</label><input id={id("from")} type="date" name="from" className={inputClass} /></div>
            <div><label className={lbl} htmlFor={id("to")}>To</label><input id={id("to")} type="date" name="to" className={inputClass} /></div>
          </>
        ) : null}
        {def.filters.includes("branch") ? (
          <div>
            <label className={lbl} htmlFor={id("branch")}>Branch</label>
            <select id={id("branch")} name="branch" className={inputClass} defaultValue="">
              <option value="">All branches</option>
              {look.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        ) : null}
        {def.filters.includes("team") ? (
          <div>
            <label className={lbl} htmlFor={id("team")}>Team</label>
            <select id={id("team")} name="team" className={inputClass} defaultValue="">
              <option value="">All teams</option>
              {look.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        ) : null}
        {def.filters.includes("coach") ? (
          <div>
            <label className={lbl} htmlFor={id("coach")}>Coach</label>
            <select id={id("coach")} name="coach" className={inputClass} defaultValue="">
              <option value="">All coaches</option>
              {look.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        ) : null}
        {def.filters.includes("threshold") ? (
          <div>
            <label className={lbl} htmlFor={id("attMax")}>Attendance below (%)</label>
            <input id={id("attMax")} type="number" name="attMax" min={1} max={100} placeholder={def.id === "unpaid-low-attendance" ? String(threshold) : "Any"} className={inputClass} />
          </div>
        ) : null}
        {def.id === "attendance-records" ? (
          <div>
            <label className={lbl} htmlFor={id("status")}>Status</label>
            <select id={id("status")} name="attendanceStatus" className={inputClass} defaultValue="absent">
              <option value="">Present and absent</option>
              <option value="absent">Absences only</option>
              <option value="present">Present only</option>
            </select>
          </div>
        ) : null}
      </div>
      <div className="mt-5 flex gap-2">
        <button type="submit" name="format" value="xlsx" className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-navy px-3 text-sm font-semibold text-white hover:bg-navy-deep dark:bg-navy dark:text-navy-deep">
          <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel
        </button>
        <button type="submit" name="format" value="pdf" className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2">
          <FileText className="h-4 w-4" aria-hidden /> PDF
        </button>
      </div>
    </form>
  );
}
