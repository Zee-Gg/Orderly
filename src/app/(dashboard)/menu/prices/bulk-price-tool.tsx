"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, TrendingUp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { applyBulkPriceUpdate } from "@/lib/menu/actions";
import { computeBulkPrices, type PriceRow } from "@/lib/menu/bulk-price";
import { formatPKR, parseRupees } from "@/lib/money";
import { cn } from "@/lib/utils";

const ROUNDING = [
  { value: "100", label: "Nearest Rs 1" },
  { value: "1000", label: "Nearest Rs 10" },
  { value: "5000", label: "Nearest Rs 50" },
];

export function BulkPriceTool({ rows, categories }: { rows: PriceRow[]; categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [categoryId, setCategoryId] = useState("all");
  const [direction, setDirection] = useState<"increase" | "decrease">("increase");
  const [mode, setMode] = useState<"percent" | "fixed">("percent");
  const [amountText, setAmountText] = useState("10");
  const [rounding, setRounding] = useState("1000");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amount = mode === "percent" ? Number(amountText) : parseRupees(amountText);
  const amountValid = amount !== null && Number.isFinite(amount) && amount > 0 && !(mode === "percent" && direction === "decrease" && amount > 100);

  const preview = useMemo(() => {
    if (!amountValid) return null;
    const scoped = categoryId === "all" ? rows : rows.filter((r) => r.categoryId === categoryId);
    return computeBulkPrices(scoped, { direction, mode, amount: amount!, rounding: Number(rounding) });
  }, [rows, categoryId, direction, mode, amount, amountValid, rounding]);

  const scopeLabel = categoryId === "all" ? "the whole menu" : categories.find((c) => c.id === categoryId)?.name;
  const rule = `${direction === "increase" ? "Increase" : "Decrease"} by ${mode === "percent" ? `${amountText}%` : formatPKR(amount ?? 0)}`;

  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await applyBulkPriceUpdate({
        categoryId: categoryId === "all" ? null : categoryId,
        direction,
        mode,
        amount: amount!,
        rounding: Number(rounding) as 100 | 1000 | 5000,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      toast({ title: `${result.data!.count} prices updated` });
      router.push("/menu");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <Link href="/menu" aria-label="Back to menu" className={buttonVariants({ variant: "secondary", size: "icon" })}>
          <ArrowLeft aria-hidden />
        </Link>
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">Change prices</h1>
          <p className="text-muted">Raise or lower many prices at once. You’ll see every change before saving.</p>
        </div>
      </div>

      <Card padding="lg" className="flex flex-col gap-5">
        <Select
          label="Which items?"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={[{ value: "all", label: "Whole menu" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          wrapperClassName="max-w-sm"
        />
        <div className="flex flex-wrap gap-4">
          <Tabs
            variant="segmented"
            aria-label="Increase or decrease"
            value={direction}
            onValueChange={setDirection}
            items={[
              { value: "increase", label: "Increase" },
              { value: "decrease", label: "Decrease" },
            ]}
          />
          <Tabs
            variant="segmented"
            aria-label="Percent or rupees"
            value={mode}
            onValueChange={(m) => {
              setMode(m);
              setAmountText(m === "percent" ? "10" : "50");
            }}
            items={[
              { value: "percent", label: "By %" },
              { value: "fixed", label: "By Rs" },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          {mode === "percent" ? (
            <Input
              label="Percent"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              trailing={<span className="pr-4 font-semibold text-muted">%</span>}
              wrapperClassName="w-40"
              error={!amountValid && amountText ? "Enter a number above 0" : undefined}
            />
          ) : (
            <MoneyInput
              label="Amount"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              wrapperClassName="w-40"
              error={!amountValid && amountText ? "Enter an amount above 0" : undefined}
            />
          )}
          <Select label="Round to" value={rounding} onChange={(e) => setRounding(e.target.value)} options={ROUNDING} wrapperClassName="w-48" />
        </div>
      </Card>

      {preview ? (
        <Card padding="none" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <div>
              <h2 className="text-lg font-bold">Preview</h2>
              <p className="text-sm text-muted">
                {preview.changes.length} price{preview.changes.length === 1 ? "" : "s"} will change in {scopeLabel}
                {preview.unchanged ? ` · ${preview.unchanged} stay the same` : ""}
              </p>
            </div>
            <Button
              icon={<TrendingUp />}
              disabled={!preview.changes.length || preview.belowZero.length > 0}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              Apply {preview.changes.length} changes
            </Button>
          </div>
          {preview.belowZero.length ? (
            <Alert className="m-4">
              {preview.belowZero.length} price(s) would go below Rs 0. Use a smaller amount.
            </Alert>
          ) : null}
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-subtle text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-2 font-semibold">Item</th>
                  <th className="px-4 py-2 text-right font-semibold">Now</th>
                  <th className="px-2 py-2" aria-hidden />
                  <th className="px-4 py-2 text-right font-semibold">New</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.changes.map((c) => (
                  <tr key={`${c.kind}-${c.id}-${c.branchId ?? ""}`}>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold">{c.itemName}</span>
                      {c.label ? <span className="text-muted"> · {c.label}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted">{formatPKR(c.price)}</td>
                    <td className="px-2 text-muted">
                      <ArrowRight aria-hidden className="size-4" />
                    </td>
                    <td className={cn("px-4 py-2.5 text-right font-bold whitespace-nowrap", c.newPrice < 0 && "text-danger")}>
                      {c.newPrice < 0 ? `-${formatPKR(-c.newPrice)}` : formatPKR(c.newPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.changes.length === 0 ? <p className="p-4 text-sm text-muted">No prices would change.</p> : null}
          </div>
        </Card>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        icon={<TrendingUp />}
        title={`Change ${preview?.changes.length ?? 0} prices?`}
        description={`${rule} in ${scopeLabel}. New orders use the new prices right away. Past orders don't change.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={apply}>
              Apply changes
            </Button>
          </>
        }
      >
        {error ? <Alert>{error}</Alert> : null}
      </Modal>
    </div>
  );
}
