"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, CalendarCheck, FileText, GitMerge, LayoutDashboard, Menu, ReceiptText, RefreshCw, Settings, UserRound, Users, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV } from "./nav";

const ICONS = {
  dashboard: LayoutDashboard,
  players: Users,
  coaches: UserRound,
  invoices: ReceiptText,
  attendance: CalendarCheck,
  reports: FileText,
  matching: GitMerge,
  sync: RefreshCw,
  settings: Settings,
} as const;

function NavLinks({ badges, onNavigate }: { badges: Record<string, number>; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
      {NAV.map((item) => {
        const Icon = ICONS[item.icon];
        const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badge = badges[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className={cn("h-[18px] w-[18px]", active ? "text-white" : "text-white/55 group-hover:text-white")} aria-hidden />
            <span className="flex-1">{item.label}</span>
            {badge ? <span className="rounded-full bg-brand-red px-1.5 py-0.5 text-[11px] font-bold text-white tabular">{badge}</span> : null}
            {active ? <span className="absolute left-0 h-6 w-1 rounded-r bg-brand-red" aria-hidden /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3 px-5 py-5">
      <Image src="/logo.png" alt="BFA" width={36} height={36} priority />
      <div className="leading-tight">
        <p className="font-display text-[15px] font-semibold uppercase tracking-wider text-white">Beirut Football</p>
        <p className="font-display text-[11px] uppercase tracking-[0.2em] text-white/55">Academy · Admin</p>
      </div>
    </Link>
  );
}

export function Sidebar({ badges }: { badges: Record<string, number> }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-navy lg:flex">
      <Brand />
      <div className="relative flex-1 overflow-y-auto pb-6">
        <NavLinks badges={badges} />
      </div>
      <div className="border-t border-white/10 px-5 py-4 text-[11px] text-white/40">
        <BarChart3 className="mr-1 inline h-3 w-3" aria-hidden /> Odoo + BFA attendance
      </div>
    </aside>
  );
}

export function MobileNav({ badges }: { badges: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-brand-navy" key={pathname}>
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button type="button" className="rounded-lg p-2 text-white/70 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative flex-1 overflow-y-auto pb-6">
              <NavLinks badges={badges} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
