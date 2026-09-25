import { readFile } from "node:fs/promises";
import path from "node:path";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { Column, ReportOutput } from "./definitions";
import { fmtSummary } from "./excel";

const NAVY: [number, number, number] = [27, 36, 82];
const RED: [number, number, number] = [200, 32, 46];
const MUTED: [number, number, number] = [91, 97, 120];

let logoCache: string | null | undefined;
async function logo(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = `data:image/png;base64,${(await readFile(path.join(process.cwd(), "public", "logo-small.png"))).toString("base64")}`;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

function formatCell(v: unknown, type: Column["type"], currency: string): string {
  if (v === null || v === undefined || v === "") return type === "pct" ? "—" : "";
  if (type === "money" && typeof v === "number") return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  if (type === "pct" && typeof v === "number") return `${v.toFixed(1)}%`;
  if (type === "int" && typeof v === "number") return v.toLocaleString("en-US");
  if (type === "date" && typeof v === "string") {
    const [y, m, d] = v.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }
  return String(v);
}

/** Printable A4 landscape report with BFA branding, summary, tables and page numbers. */
export async function renderPdf(report: ReportOutput): Promise<Buffer> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 36;
  const img = await logo();

  // Header band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, 64, "F");
  doc.setFillColor(...RED);
  doc.rect(0, 64, pageW, 3, "F");
  if (img) doc.addImage(img, "PNG", margin, 10, 44, 44);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(report.title, margin + (img ? 56 : 0), 32, { maxWidth: pageW - margin * 2 - 180 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Beirut Football Academy", margin + (img ? 56 : 0), 48);
  doc.text(`Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Beirut" })}`, pageW - margin, 48, { align: "right" });

  let y = 88;
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  doc.text(report.subtitle, margin, y, { maxWidth: pageW - margin * 2 });
  y += 16;

  // Summary tiles
  if (report.summary.length) {
    const tileW = Math.min(150, (pageW - margin * 2 - 8 * (report.summary.length - 1)) / report.summary.length);
    report.summary.forEach((s, i) => {
      const x = margin + i * (tileW + 8);
      doc.setDrawColor(227, 229, 240);
      doc.setFillColor(246, 247, 251);
      doc.roundedRect(x, y, tileW, 40, 4, 4, "FD");
      doc.setTextColor(...MUTED);
      doc.setFontSize(7.5);
      doc.text(s.label.toUpperCase(), x + 8, y + 14);
      doc.setTextColor(22, 28, 63);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(fmtSummary(s.value, s.type, report.currency), x + 8, y + 31, { maxWidth: tileW - 12 });
      doc.setFont("helvetica", "normal");
    });
    y += 66;
  }

  for (const section of report.sections) {
    doc.setTextColor(22, 28, 63);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      y = margin;
    }
    doc.text(`${section.title} (${section.rows.length})`, margin, y);
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: y + 6,
      margin: { left: margin, right: margin, top: margin, bottom: 40 },
      head: [section.columns.map((c) => c.header)],
      body: section.rows.length
        ? section.rows.map((r) => section.columns.map((c) => formatCell(r[c.key], c.type, report.currency)))
        : [[{ content: "No records for these filters.", colSpan: section.columns.length, styles: { halign: "center", textColor: MUTED, fontStyle: "italic" } }]],
      styles: { font: "helvetica", fontSize: 8, cellPadding: 4, textColor: [22, 28, 63], lineColor: [227, 229, 240], lineWidth: 0.5, overflow: "linebreak" },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: Object.fromEntries(section.columns.map((c, i) => [i, { halign: c.type && c.type !== "text" && c.type !== "date" ? "right" : "left" }])),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const h = doc.internal.pageSize.getHeight();
    doc.text("BFA Admin · Confidential", margin, h - 18);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, h - 18, { align: "right" });
  }
  return Buffer.from(doc.output("arraybuffer"));
}
