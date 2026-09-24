"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { week: string; player_rate: number | null; coach_rate: number | null };

function weekLabel(w: string) {
  const [y, m, d] = w.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const NAMES: Record<string, string> = { player_rate: "Players", coach_rate: "Coaches" };

export function AttendanceChart({ data, threshold }: { data: Point[]; threshold: number }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Weekly attendance rate for players and coaches">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} axisLine={{ stroke: "var(--line-strong)" }} tickLine={false} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
          <ReferenceLine y={threshold} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: `Low (${threshold}%)`, fill: "var(--muted)", fontSize: 11, position: "insideBottomRight" }} />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)", fontSize: 13 }}
            labelFormatter={(l) => `Week of ${weekLabel(String(l))}`}
            formatter={(v, name) => [v === null || v === undefined ? "No sessions" : `${Number(v).toFixed(1)}%`, NAMES[String(name)] ?? String(name)]}
          />
          <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={8}
            formatter={(v) => <span style={{ color: "var(--ink-2)", fontSize: 12 }}>{NAMES[String(v)] ?? v}</span>} />
          <Line type="monotone" dataKey="player_rate" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--chart-1)" }} activeDot={{ r: 5 }} connectNulls animationDuration={500} />
          <Line type="monotone" dataKey="coach_rate" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--chart-2)" }} activeDot={{ r: 5 }} connectNulls animationDuration={500} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
