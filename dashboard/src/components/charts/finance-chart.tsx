"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { month: string; invoiced: number; collected: number };

function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function FinanceChart({ data, currency }: { data: Point[]; currency: string }) {
  const fmt = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, notation: v >= 10000 ? "compact" : "standard", maximumFractionDigits: 0 }).format(v);
  return (
    <div className="h-72 w-full" role="img" aria-label="Invoiced and collected amounts per month">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
          <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} axisLine={{ stroke: "var(--line-strong)" }} tickLine={false} />
          <YAxis tickFormatter={fmt} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
          <Tooltip
            cursor={{ fill: "var(--surface-3)", opacity: 0.6 }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)", fontSize: 13 }}
            labelFormatter={(l) => monthLabel(String(l))}
            formatter={(v, name) => [fmt(Number(v)), name === "invoiced" ? "Invoiced" : "Collected"]}
          />
          <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={8}
            formatter={(v) => <span style={{ color: "var(--ink-2)", fontSize: 12 }}>{v === "invoiced" ? "Invoiced" : "Collected"}</span>} />
          <Bar dataKey="invoiced" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} stroke="var(--surface)" strokeWidth={1} />
          <Bar dataKey="collected" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={22} stroke="var(--surface)" strokeWidth={1} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
