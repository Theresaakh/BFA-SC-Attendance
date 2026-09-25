import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-navy text-white hover:bg-navy-deep border border-transparent dark:bg-navy dark:text-navy-deep dark:hover:bg-navy-2",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink-2 border border-transparent hover:bg-surface-2",
  danger: "bg-surface text-bad border border-line-strong hover:bg-bad-soft",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({ href, variant = "secondary", size = "md", className, children, prefetch }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; prefetch?: boolean }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} prefetch={prefetch}>
      {children}
    </Link>
  );
}
