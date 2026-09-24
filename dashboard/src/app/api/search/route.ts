import { sql } from "drizzle-orm";
import { apiUser, authErrorResponse } from "@/lib/auth/guard";
import { likePattern, rows } from "@/lib/queries/common";

export const dynamic = "force-dynamic";

type Hit = { type: "player" | "coach" | "invoice" | "customer"; id: number; title: string; subtitle: string; href: string };

export async function GET(req: Request) {
  try {
    await apiUser();
  } catch (err) {
    return authErrorResponse(err)!;
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return Response.json({ results: [] });
  const like = likePattern(q);
  const [players, coaches, invoices, customers] = await Promise.all([
    rows<{ id: number; name: string; team: string | null; branch: string | null }>(sql`
      select p.id, p.name, t.name as team, b.name as branch from players p
      left join teams t on t.id = p.team_id left join branches b on b.id = p.branch_id
      where p.deleted_at is null and (p.name ilike ${like} or p.external_id = ${q})
      order by (p.name ilike ${`${q.replace(/[\\%_]/g, "\\$&")}%`}) desc, p.name limit 8`),
    rows<{ id: number; name: string }>(sql`select id, name from coaches where deleted_at is null and name ilike ${like} order by name limit 4`),
    rows<{ id: number; number: string; customer: string | null; player_id: number | null }>(sql`
      select i.id, i.number, oc.name as customer,
        (select rl.player_id from record_links rl where rl.customer_id = i.customer_id and rl.status = 'confirmed' limit 1) as player_id
      from invoices i left join odoo_customers oc on oc.id = i.customer_id
      where i.deleted_at is null and i.number ilike ${like} order by i.invoice_date desc nulls last limit 5`),
    rows<{ id: number; name: string }>(sql`
      select oc.id, oc.name from odoo_customers oc
      where oc.deleted_at is null and oc.name ilike ${like}
        and not exists (select 1 from record_links rl where rl.customer_id = oc.id and rl.status = 'confirmed')
      order by oc.name limit 4`),
  ]);
  const results: Hit[] = [
    ...players.map((p) => ({ type: "player" as const, id: p.id, title: p.name, subtitle: [p.team, p.branch].filter(Boolean).join(" · ") || "No team", href: `/players/${p.id}` })),
    ...coaches.map((c) => ({ type: "coach" as const, id: c.id, title: c.name, subtitle: "Coach", href: `/coaches/${c.id}` })),
    ...invoices.map((i) => ({ type: "invoice" as const, id: i.id, title: i.number, subtitle: i.customer ?? "No customer", href: i.player_id ? `/players/${i.player_id}` : `/invoices?q=${encodeURIComponent(i.number)}` })),
    ...customers.map((c) => ({ type: "customer" as const, id: c.id, title: c.name, subtitle: "Odoo customer · not linked to a player", href: `/matching?tab=customers&q=${encodeURIComponent(c.name)}` })),
  ];
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
