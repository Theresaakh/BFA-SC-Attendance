const TZ = "Asia/Beirut";

export function formatMoney(n: number | null | undefined, currency = "USD"): string {
  const v = Number(n ?? 0);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(v);
  } catch {
    return `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

export function formatNumber(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}

export function formatPct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Dates stored as YYYY-MM-DD are calendar dates; format them without timezone shifts. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Today's date in the academy's timezone, as YYYY-MM-DD. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export type Tone = "green" | "amber" | "red" | "orange" | "blue" | "gray" | "navy";

export const PAYMENT_STATE: Record<string, { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "green" },
  in_payment: { label: "In payment", tone: "blue" },
  partial: { label: "Partially paid", tone: "amber" },
  not_paid: { label: "Unpaid", tone: "red" },
  reversed: { label: "Reversed", tone: "gray" },
  invoicing_legacy: { label: "Legacy", tone: "gray" },
};

export const INVOICE_STATE: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "gray" },
  posted: { label: "Posted", tone: "navy" },
  cancel: { label: "Cancelled", tone: "gray" },
};

export function attendanceTone(rate: number | null | undefined, threshold: number): Tone {
  if (rate === null || rate === undefined) return "gray";
  if (rate < threshold) return "red";
  if (rate < threshold + 15) return "amber";
  return "green";
}

export function playerFinanceStatus(invoiced: number, outstanding: number, invoiceCount: number): { label: string; tone: Tone } {
  if (!invoiceCount) return { label: "No invoices", tone: "gray" };
  if (outstanding <= 0.005) return { label: "Paid", tone: "green" };
  if (outstanding < invoiced - 0.005) return { label: "Partially paid", tone: "amber" };
  return { label: "Unpaid", tone: "red" };
}
