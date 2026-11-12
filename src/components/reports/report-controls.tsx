"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/reports/range";

/** Date range + branch at the top of /reports. Everything lives in the URL. */
export function ReportControls({
  range,
  from,
  to,
  today,
  branch,
  branches,
  canPickAll,
}: {
  range: RangeKey;
  from: string;
  to: string;
  today: string;
  branch: string | null;
  branches: { id: string; name: string }[];
  canPickAll: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [showCustom, setShowCustom] = useState(range === "custom");
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  function go(next: { range?: RangeKey; from?: string; to?: string; branch?: string | null }) {
    const r = next.range ?? range;
    const params = new URLSearchParams({ range: r });
    if (r === "custom") {
      params.set("from", next.from ?? from);
      params.set("to", next.to ?? to);
    }
    const b = next.branch === undefined ? branch : next.branch;
    params.set("branch", b ?? "all");
    start(() => router.push(`${pathname}?${params}`, { scroll: false }));
  }

  const branchOptions = [
    ...(canPickAll ? [{ value: "all", label: "All branches" }] : []),
    ...branches.map((b) => ({ value: b.id, label: b.name })),
  ];

  return (
    <div className="mb-4 flex flex-col gap-3" data-testid="report-controls">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <Tabs
            variant="segmented"
            aria-label="Date range"
            value={showCustom ? "custom" : range}
            onValueChange={(v) => {
              if (v === "custom") {
                setShowCustom(true);
                return;
              }
              setShowCustom(false);
              go({ range: v });
            }}
            items={RANGE_KEYS.map((k) => ({ value: k, label: RANGE_LABELS[k] }))}
          />
        </div>
        <div className="flex items-center gap-2">
          {pending ? <Loader2 aria-label="Loading" className="size-5 animate-spin text-muted" /> : null}
          {branchOptions.length > 1 ? (
            <Select
              aria-label="Branch"
              options={branchOptions}
              value={branch ?? "all"}
              onChange={(e) => go({ branch: e.target.value === "all" ? null : e.target.value })}
              wrapperClassName="min-w-48"
            />
          ) : null}
        </div>
      </div>
      {showCustom ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!customFrom || !customTo) return;
            go({ range: "custom", from: customFrom, to: customTo });
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            From
            <input
              type="date"
              value={customFrom}
              max={today}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="min-h-touch rounded-control border border-line-strong bg-surface px-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            To
            <input
              type="date"
              value={customTo}
              max={today}
              onChange={(e) => setCustomTo(e.target.value)}
              className="min-h-touch rounded-control border border-line-strong bg-surface px-3"
            />
          </label>
          <Button type="submit" loading={pending}>
            Show
          </Button>
        </form>
      ) : null}
    </div>
  );
}
