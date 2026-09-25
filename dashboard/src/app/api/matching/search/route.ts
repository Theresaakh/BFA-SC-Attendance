import { apiUser, authErrorResponse } from "@/lib/auth/guard";
import { searchCustomers, searchPlayers } from "@/lib/queries/matching";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await apiUser({ admin: true });
  } catch (err) {
    return authErrorResponse(err)!;
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const type = url.searchParams.get("type");
  if (q.length < 2 || (type !== "customer" && type !== "player")) return Response.json({ results: [] });
  const results = type === "customer" ? await searchCustomers(q) : await searchPlayers(q);
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
