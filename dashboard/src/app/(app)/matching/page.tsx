import Link from "next/link";
import { GitMerge } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import type { RawSearchParams } from "@/lib/filters";
import { formatDate, formatMoney } from "@/lib/format";
import { companyCurrency } from "@/lib/queries/common";
import { confirmedLinks, matchingCounts, suggestions, unmatchedCustomers, unmatchedPlayers } from "@/lib/queries/matching";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyRow, Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState, PageHeader, Tabs } from "@/components/ui/misc";
import { inputClass } from "@/components/filter-bar";
import { LinkPicker, SuggestionActions, UnlinkButton } from "./controls";

export const metadata = { title: "Unmatched records" };

const TABS = ["review", "players", "customers", "linked"] as const;
type Tab = (typeof TABS)[number];

const METHOD: Record<string, string> = {
  player_id: "Player ID", email: "E-mail", phone: "Phone", name_exact: "Exact name", name_fuzzy: "Similar name", manual: "Manual",
};

export default async function MatchingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireUser();
  const canEdit = user.role === "admin";
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "review";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) || undefined : undefined;
  const [counts, currency] = await Promise.all([matchingCounts(), companyCurrency()]);

  return (
    <>
      <PageHeader
        title="Unmatched records"
        subtitle="Connect players in the attendance app with their customer records in Odoo. Uncertain matches are never merged automatically."
      />
      {!canEdit ? <div className="mb-4"><Alert tone="info">You have read-only access. An administrator can link records.</Alert></div> : null}
      <Tabs
        active={tab}
        items={[
          { key: "review", label: "Suggested matches", href: "/matching?tab=review", count: counts.suggestions },
          { key: "players", label: "Players without Odoo link", href: "/matching?tab=players", count: counts.unmatched_players },
          { key: "customers", label: "Odoo customers without player", href: "/matching?tab=customers", count: counts.unmatched_customers },
          { key: "linked", label: "Linked", href: "/matching?tab=linked", count: counts.confirmed },
        ]}
      />
      {tab !== "review" ? (
        <form action="/matching" method="get" className="mb-4 flex max-w-md gap-2" role="search">
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={q} placeholder="Filter by name…" className={inputClass} maxLength={100} aria-label="Filter by name" />
          <button type="submit" className="h-9 rounded-lg bg-brand-navy px-4 text-sm font-semibold text-white dark:bg-navy dark:text-navy-deep">Filter</button>
        </form>
      ) : null}
      {tab === "review" ? <Review canEdit={canEdit} currency={currency} /> : null}
      {tab === "players" ? <Players canEdit={canEdit} q={q} /> : null}
      {tab === "customers" ? <Customers canEdit={canEdit} q={q} currency={currency} /> : null}
      {tab === "linked" ? <Linked canEdit={canEdit} q={q} /> : null}
    </>
  );
}

async function Review({ canEdit, currency }: { canEdit: boolean; currency: string }) {
  const rows = await suggestions();
  if (!rows.length) {
    return (
      <Card>
        <EmptyState icon={<GitMerge className="h-5 w-5" />} title="No suggestions to review">
          Every automatic match has been decided. Players that still have no link are listed under “Players without Odoo link”.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Possible matches" subtitle="Check each pair and link it only if it is the same person (or the parent who pays for the player)." />
      <Table>
        <thead>
          <tr><Th>Player (attendance app)</Th><Th>Odoo customer</Th><Th>Evidence</Th><Th className="text-right">Decision</Th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.link_id}>
              <Td>
                <Link href={`/players/${r.player_id}`} className="font-semibold hover:underline">{r.player_name}</Link>
                <p className="text-xs text-muted">{[r.team_name, r.branch_name].filter(Boolean).join(" · ") || "No team"} · ID {r.player_external_id}</p>
              </Td>
              <Td>
                <p className="font-semibold">{r.customer_name}</p>
                <p className="text-xs text-muted">
                  {[`Odoo #${r.customer_odoo_id}`, r.customer_email, r.customer_phone, r.customer_reference && `Ref ${r.customer_reference}`].filter(Boolean).join(" · ")}
                </p>
                <p className="text-xs text-muted">{r.invoice_count} invoice(s){r.outstanding > 0 ? ` · ${formatMoney(r.outstanding, currency)} outstanding` : ""}</p>
              </Td>
              <Td>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={r.confidence >= 0.8 ? "green" : r.confidence >= 0.65 ? "amber" : "orange"} dot={false}>{Math.round(r.confidence * 100)}%</Badge>
                  <Badge tone="gray" dot={false}>{METHOD[r.method] ?? r.method}</Badge>
                </div>
                <ul className="mt-1 text-xs text-muted">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
              </Td>
              <Td className="text-right"><SuggestionActions linkId={r.link_id} canEdit={canEdit} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

async function Players({ canEdit, q }: { canEdit: boolean; q?: string }) {
  const rows = await unmatchedPlayers(q);
  return (
    <Card>
      <CardHeader title="Players without an Odoo customer" subtitle="Their invoices cannot be shown until they are linked." />
      <Table>
        <thead>
          <tr><Th>Player</Th><Th>Team</Th><Th className="text-right">Sessions</Th><Th>Suggestions</Th><Th className="text-right">Action</Th></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <Tr key={p.id}>
              <Td><Link href={`/players/${p.id}`} className="font-semibold hover:underline">{p.name}</Link><p className="text-xs text-muted">ID {p.external_id}</p></Td>
              <Td className="text-ink-2">{[p.team_name, p.branch_name].filter(Boolean).join(" · ") || "—"}</Td>
              <Td className="text-right tabular">{p.sessions}</Td>
              <Td>{p.suggestions ? <Link href="/matching?tab=review"><Badge tone="amber">{p.suggestions} to review</Badge></Link> : <span className="text-xs text-muted">None</span>}</Td>
              <Td className="text-right"><div className="flex justify-end"><LinkPicker from="player" fromId={p.id} canEdit={canEdit} initialQuery={p.name.split(" ").slice(-1)[0]} /></div></Td>
            </Tr>
          ))}
          {!rows.length ? <EmptyRow colSpan={5}>{q ? "No unmatched players with that name." : "Every player is linked to an Odoo customer."}</EmptyRow> : null}
        </tbody>
      </Table>
    </Card>
  );
}

async function Customers({ canEdit, q, currency }: { canEdit: boolean; q?: string; currency: string }) {
  const rows = await unmatchedCustomers(q);
  return (
    <Card>
      <CardHeader title="Odoo customers with invoices but no player" subtitle="Often a parent's name or a spelling difference. Link each one to the player(s) it pays for." />
      <Table>
        <thead>
          <tr><Th>Odoo customer</Th><Th>Contact</Th><Th className="text-right">Invoices</Th><Th className="text-right">Outstanding</Th><Th className="text-right">Action</Th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <Tr key={c.id}>
              <Td><p className="font-semibold">{c.name}</p><p className="text-xs text-muted">Odoo #{c.odoo_id}{c.reference ? ` · Ref ${c.reference}` : ""}</p></Td>
              <Td className="text-xs text-ink-2">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</Td>
              <Td className="text-right tabular">{c.invoice_count}</Td>
              <Td className={`text-right tabular font-semibold ${c.outstanding > 0 ? "text-bad" : "text-ink-2"}`}>{formatMoney(c.outstanding, currency)}</Td>
              <Td className="text-right"><div className="flex justify-end"><LinkPicker from="customer" fromId={c.id} canEdit={canEdit} initialQuery={c.name.replace(/^(parent of|mr\.?|mrs\.?)\s+/i, "").split(" ").slice(-1)[0]} /></div></Td>
            </Tr>
          ))}
          {!rows.length ? <EmptyRow colSpan={5}>{q ? "No unmatched customers with that name." : "Every Odoo customer with invoices is linked to a player."}</EmptyRow> : null}
        </tbody>
      </Table>
    </Card>
  );
}

async function Linked({ canEdit, q }: { canEdit: boolean; q?: string }) {
  const rows = await confirmedLinks(q);
  return (
    <Card>
      <CardHeader title="Linked records" subtitle="Unlinking keeps a note so the same automatic match is not proposed again." />
      <Table>
        <thead>
          <tr><Th>Player</Th><Th>Odoo customer</Th><Th>Matched by</Th><Th>Decided</Th><Th className="text-right">Action</Th></tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <Tr key={l.link_id}>
              <Td><Link href={`/players/${l.player_id}`} className="font-semibold hover:underline">{l.player_name}</Link><p className="text-xs text-muted">{l.team_name ?? "No team"}</p></Td>
              <Td><p>{l.customer_name}</p><p className="text-xs text-muted">Odoo #{l.customer_odoo_id}</p></Td>
              <Td><Badge tone={l.method === "manual" ? "navy" : "gray"} dot={false}>{METHOD[l.method] ?? l.method}</Badge></Td>
              <Td className="text-xs text-ink-2">{l.decided_by ? `${l.decided_by}${l.decided_at ? ` · ${formatDate(l.decided_at)}` : ""}` : "Automatic"}</Td>
              <Td className="text-right"><div className="flex justify-end"><UnlinkButton linkId={l.link_id} canEdit={canEdit} /></div></Td>
            </Tr>
          ))}
          {!rows.length ? <EmptyRow colSpan={5}>No linked records yet.</EmptyRow> : null}
        </tbody>
      </Table>
    </Card>
  );
}
