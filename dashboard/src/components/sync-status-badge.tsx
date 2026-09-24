import { Badge } from "@/components/ui/badge";

const MAP = {
  success: { tone: "green", label: "Success" },
  partial: { tone: "amber", label: "Completed with warnings" },
  failed: { tone: "red", label: "Failed" },
  running: { tone: "blue", label: "Running" },
} as const;

export function SyncStatusBadge({ status }: { status: keyof typeof MAP }) {
  const s = MAP[status] ?? MAP.failed;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const SOURCE_LABEL: Record<string, string> = { odoo: "Odoo invoices", bfa: "BFA attendance", matching: "Record matching" };
export const TRIGGER_LABEL: Record<string, string> = { manual: "Sync now", scheduled: "Scheduled", cron: "External cron", cli: "Command line" };
