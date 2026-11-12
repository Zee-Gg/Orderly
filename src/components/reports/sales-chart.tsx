"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatPKR } from "@/lib/money";

export type SalesBar = { day: string; label: string; sales: number; orders: number; highlight: boolean };

/** "68.4k" for a bar label (amounts are paisa). */
function compactRupees(paisa: number) {
  const rs = paisa / 100;
  if (rs >= 100_000) return `${(rs / 100_000).toFixed(rs >= 1_000_000 ? 0 : 1)}L`;
  if (rs >= 1000) return `${(rs / 1000).toFixed(1)}k`;
  return rs ? String(Math.round(rs)) : "";
}

/** Sales by day. Simple bars, the last/selected day in the brand color. */
export function SalesChart({ bars }: { bars: SalesBar[] }) {
  const many = bars.length > 14;
  return (
    <div className="h-64 w-full" role="img" aria-label={`Sales by day: ${bars.map((b) => `${b.label} ${formatPKR(b.sales)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 24, right: 0, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            interval={many ? "preserveStartEnd" : 0}
            minTickGap={4}
          />
          <Tooltip
            cursor={{ fill: "var(--color-subtle)" }}
            formatter={(value) => [formatPKR(Number(value)), "Sales"]}
            labelFormatter={(_, payload) => {
              const p = payload?.[0]?.payload as SalesBar | undefined;
              return p ? `${p.label} · ${p.orders} order${p.orders === 1 ? "" : "s"}` : "";
            }}
            contentStyle={{ borderRadius: 12, borderColor: "var(--color-line)", fontSize: 14 }}
          />
          <Bar dataKey="sales" radius={[6, 6, 0, 0]} isAnimationActive={false}>
            {bars.map((b) => (
              <Cell key={b.day} fill={b.highlight ? "var(--color-brand-700)" : "var(--color-brand-200)"} />
            ))}
            {many ? null : (
              <LabelList dataKey="sales" position="top" formatter={(v) => compactRupees(Number(v))} style={{ fill: "var(--color-muted)", fontSize: 12 }} />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
