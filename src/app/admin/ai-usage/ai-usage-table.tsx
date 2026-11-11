"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { setAiBudgetAction } from "@/lib/bot/admin-actions";

type Period = { conversations: number; orders: number; tokens: number; cost: number };
export type UsageRow = {
  id: string;
  name: string;
  slug: string;
  today: Period;
  month: Period;
  costPerOrder: number | null;
  budgetUsd: number | null;
  overBudget: boolean;
};

const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const int = (n: number) => n.toLocaleString("en-US");

function BudgetEditor({ row }: { row: UsageRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(row.budgetUsd === null ? "" : String(row.budgetUsd));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        const budgetUsd = trimmed === "" ? null : Number(trimmed);
        if (budgetUsd !== null && !Number.isFinite(budgetUsd)) {
          setError("Enter dollars, e.g. 25");
          return;
        }
        start(async () => {
          setError(null);
          const r = await setAiBudgetAction({ restaurantId: row.id, budgetUsd });
          if (!r.ok) {
            setError(r.fieldErrors?.budgetUsd ?? r.error);
            return;
          }
          toast({ title: `Budget saved for ${row.name}` });
          router.refresh();
        });
      }}
    >
      <Input
        label="Monthly AI budget (USD)"
        inputMode="decimal"
        placeholder="No limit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error ?? undefined}
        wrapperClassName="w-44"
      />
      <Button type="submit" variant="secondary" loading={pending}>
        Save
      </Button>
    </form>
  );
}

export function AiUsageTable({ rows }: { rows: UsageRow[] }) {
  if (!rows.length) return <EmptyState icon={<Bot />} title="No restaurants yet" description="Restaurants appear here once they sign up." />;
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <Card key={r.id} padding="lg" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex-1 text-lg font-bold">
              {r.name} <span className="text-sm font-normal text-muted">/{r.slug}</span>
            </h2>
            {r.overBudget ? (
              <Badge tone="cancelled" shape="square" icon={<TriangleAlert />}>
                Over budget: new chats go to staff
              </Badge>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 font-semibold" scope="col"></th>
                  <th className="py-1 font-semibold" scope="col">Bot chats</th>
                  <th className="py-1 font-semibold" scope="col">Bot orders</th>
                  <th className="py-1 font-semibold" scope="col">Tokens</th>
                  <th className="py-1 font-semibold" scope="col">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Today", r.today],
                    ["This month", r.month],
                  ] as const
                ).map(([label, p]) => (
                  <tr key={label} className="border-t border-line">
                    <th scope="row" className="py-1.5 text-left font-semibold">
                      {label}
                    </th>
                    <td>{int(p.conversations)}</td>
                    <td>{int(p.orders)}</td>
                    <td>{int(p.tokens)}</td>
                    <td>{usd(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">
            Average cost per bot order this month: <span className="font-semibold text-ink">{r.costPerOrder === null ? "—" : usd(r.costPerOrder)}</span>
            {r.budgetUsd !== null ? ` · budget ${usd(r.budgetUsd)} (${Math.round((r.month.cost / Math.max(r.budgetUsd, 0.0001)) * 100)}% used)` : ""}
          </p>
          <BudgetEditor row={r} />
        </Card>
      ))}
    </div>
  );
}
