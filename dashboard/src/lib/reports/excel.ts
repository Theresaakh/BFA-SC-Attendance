import ExcelJS from "exceljs";
import type { Column, ReportOutput } from "./definitions";

const NAVY = "FF1B2452";

function numFmt(type: Column["type"], currency: string) {
  switch (type) {
    case "money": return `#,##0.00 "${currency}"`;
    case "pct": return "0.0%";
    case "int": return "#,##0";
    case "date": return "dd mmm yyyy";
    default: return undefined;
  }
}

function cellValue(v: unknown, type: Column["type"]): ExcelJS.CellValue {
  if (v === null || v === undefined || v === "") return null;
  if (type === "pct") return typeof v === "number" ? v / 100 : String(v);
  if (type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return v as ExcelJS.CellValue;
}

/** One worksheet per section, with a title block, styled header, number formats, filters and frozen header. */
export async function renderExcel(report: ReportOutput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BFA Admin";
  wb.created = new Date();
  const generated = `Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Beirut" })}`;

  const used = new Set<string>();
  for (const section of report.sections) {
    let name = section.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Report";
    while (used.has(name)) name = `${name.slice(0, 28)} ${used.size}`;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 5 }] });
    const width = Math.max(section.columns.length, 2);

    ws.mergeCells(1, 1, 1, width);
    ws.getCell(1, 1).value = report.title;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
    ws.mergeCells(2, 1, 2, width);
    ws.getCell(2, 1).value = report.subtitle;
    ws.getCell(2, 1).font = { size: 10, color: { argb: "FF5B6178" } };
    ws.mergeCells(3, 1, 3, width);
    ws.getCell(3, 1).value = `${generated} · ${report.summary.map((s) => `${s.label}: ${fmtSummary(s.value, s.type, report.currency)}`).join(" · ")}`;
    ws.getCell(3, 1).font = { size: 10, color: { argb: "FF5B6178" } };

    const header = ws.getRow(5);
    section.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cell.alignment = { vertical: "middle", horizontal: c.type && c.type !== "text" && c.type !== "date" ? "right" : "left" };
      ws.getColumn(i + 1).width = c.width ?? 16;
      const fmt = numFmt(c.type, report.currency);
      if (fmt) ws.getColumn(i + 1).numFmt = fmt;
    });
    header.height = 20;

    section.rows.forEach((r, idx) => {
      const row = ws.getRow(6 + idx);
      section.columns.forEach((c, i) => {
        row.getCell(i + 1).value = cellValue(r[c.key], c.type);
      });
    });
    if (section.rows.length) {
      ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + section.rows.length, column: section.columns.length } };
      // Totals row for money/count columns.
      const totals = ws.getRow(6 + section.rows.length);
      let any = false;
      section.columns.forEach((c, i) => {
        if (c.type === "money") {
          const col = ws.getColumn(i + 1).letter;
          totals.getCell(i + 1).value = { formula: `SUBTOTAL(9,${col}6:${col}${5 + section.rows.length})` };
          any = true;
        }
      });
      if (any) {
        totals.getCell(1).value = "Total";
        totals.font = { bold: true };
        totals.eachCell((cell) => { cell.border = { top: { style: "thin", color: { argb: NAVY } } }; });
      }
    } else {
      ws.getCell(6, 1).value = "No records for these filters.";
      ws.getCell(6, 1).font = { italic: true, color: { argb: "FF7A809C" } };
    }
  }
  if (!report.sections.length) wb.addWorksheet("Report").getCell(1, 1).value = report.title;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function fmtSummary(v: string | number, type: Column["type"], currency: string) {
  if (typeof v !== "number") return String(v);
  if (type === "money") return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  if (type === "pct") return `${v.toFixed(1)}%`;
  return v.toLocaleString("en-US");
}
