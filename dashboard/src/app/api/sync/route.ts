import { after } from "next/server";
import { z } from "zod";
import { apiUser, authErrorResponse } from "@/lib/auth/guard";
import { getSyncOverview, runSync } from "@/lib/sync/runner";

export const dynamic = "force-dynamic";

function serialize(o: Awaited<ReturnType<typeof getSyncOverview>>) {
  return {
    running: o.running,
    lastSuccessAt: o.lastSuccessAt?.toISOString() ?? null,
    sources: o.sources.map((s) => ({
      source: s.source,
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      lastRun: s.lastRun ? { status: s.lastRun.status, message: s.lastRun.message, startedAt: s.lastRun.startedAt.toISOString() } : null,
    })),
  };
}

export async function GET() {
  try {
    await apiUser();
    return Response.json(serialize(await getSyncOverview()), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Could not read the synchronisation status." }, { status: 500 });
  }
}

const bodySchema = z.object({
  sources: z.array(z.enum(["odoo", "bfa"])).min(1).max(2).optional(),
  full: z.boolean().optional(),
});

/** Starts a synchronisation in the background (admins only); poll GET for progress. */
export async function POST(req: Request) {
  try {
    const user = await apiUser({ admin: true, mutating: true });
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
    const overview = await getSyncOverview();
    if (overview.running) return Response.json({ error: "A synchronisation is already running." }, { status: 409 });
    after(async () => {
      try {
        await runSync({ sources: parsed.data.sources, full: parsed.data.full, trigger: "manual", userId: user.id });
      } catch (err) {
        console.error("[sync] manual run crashed:", err);
      }
    });
    return Response.json({ started: true }, { status: 202 });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Could not start the synchronisation." }, { status: 500 });
  }
}
