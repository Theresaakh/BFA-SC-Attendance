import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/format";

const TONES: Record<Tone, string> = {
  green: "bg-good-soft text-good",
  amber: "bg-warn-soft text-warn",
  red: "bg-bad-soft text-bad",
  orange: "bg-orange-soft text-orange",
  blue: "bg-info-soft text-info",
  gray: "bg-surface-3 text-ink-2",
  navy: "bg-surface-3 text-navy",
};

const DOTS: Record<Tone, string> = {
  green: "bg-good",
  amber: "bg-warn",
  red: "bg-bad",
  orange: "bg-orange",
  blue: "bg-info",
  gray: "bg-muted",
  navy: "bg-navy",
};

/** Status pill: always a dot plus a text label, so meaning never relies on colour alone. */
export function Badge({ tone = "gray", children, className, dot = true }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", TONES[tone], className)}>
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} aria-hidden /> : null}
      {children}
    </span>
  );
}
