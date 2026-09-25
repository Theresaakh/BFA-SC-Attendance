import Link from "next/link";
import { Link2Off, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { PAGE_SIZE, parseFilters, toQuery, type RawSearchParams } from "@/lib/filters";
import { formatMoney, playerFinanceStatus } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { companyCurrency } from "@/lib/queries/common";
import { listPlayers } from "@/lib/queries/players";
import { lookups } from "@/lib/queries/lookups";
import { Card } from "@/components/ui/card";
import { EmptyRow, SortTh, Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Pagination, RateBar } from "@/components/ui/misc";
import { FilterBar, optionsFrom } from "@/components/filter-bar";
import { ExportButtons } from "@/components/export-menu";

export const metadata = { title: "Players" };

export default async function PlayersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUser();
  const f = parseFilters(await searchParams);
  const page = f.page ?? 1;
  const [settings, currency, look, data] = await Promise.all([
    getSettings(),
    companyCurrency(),
    lookups(),
    listPlayers(f, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, minSessionsForRate: 1 }),
  ]);
  const threshold = settings.lowAttendanceThreshold;
  const sortHref = (sort: string, dir: "asc" | "desc") => `/players${toQuery({ ...f, page: undefined }, { sort, dir })}`;

  return (
    <>
      <PageHeader
        title="Players"
        subtitle="Attendance from the BFA app combined with invoices from Odoo"
        actions={<ExportButtons report="player-summary" query={toQuery({ ...f, page: undefined })} />}
      />
      <FilterBar
        action="/players"
        filters={f}
        primary={[
          { name: "q", label: "Search", type: "search", placeholder: "Player name or ID" },
          { name: "branch", label: "Branch", type: "select", options: optionsFrom(look.branches) },
          { name: "team", label: "Team", type: "select", options: optionsFrom(look.teams) },
          {
            name: "finance", label: "Payment status", type: "select",
            options: [
              { value: "outstanding", label: "Has unpaid invoices" },
              { value: "overdue", label: "Has overdue invoices" },
              { value: "unpaid", label: "Unpaid" },
              { value: "partial", label: "Partially paid" },
              { value: "paid", label: "Fully paid" },
              { value: "none", label: "No invoices" },
            ],
          },
          { name: "attMax", label: "Attendance below (%)", type: "number", placeholder: `e.g. ${threshold}` },
        ]}
        more={[
          { name: "coach", label: "Coach", type: "select", options: optionsFrom(look.coaches) },
          { name: "attMin", label: "Attendance at least (%)", type: "number" },
          { name: "from", label: "From date", type: "date" },
          { name: "to", label: "To date", type: "date" },
          { name: "amountMin", label: "Invoiced at least", type: "number" },
          { name: "amountMax", label: "Invoiced at most", type: "number" },
          { name: "outMin", label: "Outstanding at least", type: "number" },
          { name: "outMax", label: "Outstanding at most", type: "number" },
          { name: "attendanceStatus", label: "Attendance status", type: "select", options: [{ value: "present", label: "Count present only" }, { value: "absent", label: "Count absent only" }] },
          { name: "linked", label: "Odoo link", type: "select", options: [{ value: "yes", label: "Linked to Odoo" }, { value: "no", label: "Not linked" }] },
        ]}
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <SortTh label="Player" sortKey="name" current={f.sort} dir={f.dir} hrefFor={sortHref} />
              <SortTh label="Team" sortKey="team" current={f.sort} dir={f.dir} hrefFor={sortHref} />
              <Th>Coach</Th>
              <SortTh label="Attendance" sortKey="rate" current={f.sort} dir={f.dir} hrefFor={sortHref} />
              <SortTh label="Sessions" sortKey="sessions" current={f.sort} dir={f.dir} hrefFor={sortHref} className="text-right" />
              <SortTh label="Invoiced" sortKey="invoiced" current={f.sort} dir={f.dir} hrefFor={sortHref} className="text-right" />
              <SortTh label="Outstanding" sortKey="outstanding" current={f.sort} dir={f.dir} hrefFor={sortHref} className="text-right" />
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((p) => {
              const st = playerFinanceStatus(p.invoiced, p.outstanding, p.invoice_count);
              return (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/players/${p.id}`} className="font-semibold text-ink hover:underline">{p.name}</Link>
                    <p className="text-xs text-muted">{p.branch_name ?? "No branch"}</p>
                  </Td>
                  <Td className="whitespace-nowrap">{p.team_name ?? <span className="text-muted">—</span>}{p.category ? <span className="ml-1.5 text-xs text-muted">{p.category}</span> : null}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{p.coach_name ?? "—"}</Td>
                  <Td><RateBar rate={p.rate} threshold={threshold} detail={`${p.present} present / ${p.absent} absent`} /></Td>
                  <Td className="text-right tabular text-ink-2">{p.present}/{p.sessions}</Td>
                  <Td className="text-right tabular">{p.invoice_count ? formatMoney(p.invoiced, currency) : "—"}</Td>
                  <Td className={`text-right tabular font-semibold ${p.outstanding > 0 ? "text-bad" : "text-ink-2"}`}>{p.invoice_count ? formatMoney(p.outstanding, currency) : "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.linked ? <Badge tone={st.tone}>{st.label}</Badge> : (
                        <Link href={`/matching?tab=players&q=${encodeURIComponent(p.name)}`} title="Not linked to an Odoo customer yet">
                          <Badge tone="gray"><Link2Off className="h-3 w-3" aria-hidden /> Not linked</Badge>
                        </Link>
                      )}
                      {p.overdue_count ? <Badge tone="red" dot={false}>{p.overdue_count} overdue</Badge> : null}
                    </div>
                  </Td>
                </Tr>
              );
            })}
            {!data.rows.length ? (
              <EmptyRow colSpan={8}>
                <Users className="mx-auto mb-2 h-6 w-6" aria-hidden />
                No players match these filters.
              </EmptyRow>
            ) : null}
          </tbody>
        </Table>
        <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} hrefFor={(pg) => `/players${toQuery(f, { page: pg })}`} />
      </Card>
    </>
  );
}
