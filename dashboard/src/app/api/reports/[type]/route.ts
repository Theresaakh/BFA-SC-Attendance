import { apiUser, authErrorResponse } from "@/lib/auth/guard";
import { parseFilters } from "@/lib/filters";
import { findReport, ReportInputError, runReport } from "@/lib/reports/definitions";
import { renderExcel } from "@/lib/reports/excel";
import { renderPdf } from "@/lib/reports/pdf";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET /api/reports/<id>?format=xlsx|pdf&<filters> — downloads a report. */
export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  try {
    await apiUser();
  } catch (err) {
    return authErrorResponse(err)!;
  }
  const { type } = await ctx.params;
  const def = findReport(type);
  if (!def) return Response.json({ error: "Unknown report." }, { status: 404 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const filters = parseFilters(Object.fromEntries(url.searchParams));
  try {
    const report = await runReport(def, filters);
    const body = format === "pdf" ? await renderPdf(report) : await renderExcel(report);
    const filename = `bfa-${def.id}-${todayIso()}.${format}`;
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ReportInputError) return Response.json({ error: err.message }, { status: 400 });
    console.error(`[reports] ${type} failed:`, err);
    return Response.json({ error: "The report could not be generated. Please try again." }, { status: 500 });
  }
}
