"use client";

import { useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import type { BranchMenuItem } from "@/lib/menu/pricing";
import { previewOrderAction } from "@/lib/orders/actions";
import { formatPKR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { groupRuleText } from "@/lib/validation/menu";

export type ComposerLine = {
  key: string;
  itemId: string;
  variantId: string | null;
  optionIds: string[];
  removals: string[];
  quantity: number;
  notes: string;
};

/** Defaults for a fresh pick: default size, default options. */
export function defaultSelection(item: BranchMenuItem) {
  return {
    variantId: item.sizes.find((s) => s.isDefault)?.id ?? (item.sizes.length === 1 ? item.sizes[0].id : null),
    optionIds: item.groups.flatMap((g) => g.options.filter((o) => o.isDefault && o.isAvailable).slice(0, g.maxSelect).map((o) => o.id)),
  };
}

/** True when tapping the item can add it straight away (nothing to choose). */
export function needsPicker(item: BranchMenuItem) {
  return item.sizes.length > 1 || item.groups.length > 0 || item.removableOptions.length > 0;
}

/**
 * Size / extras / removals / note / quantity for one item. Shown prices are
 * the menu's labels; whether the choice is valid (and its real price) comes
 * from the pricing engine when you tap Add.
 */
export function ItemPicker({
  item,
  branchId,
  line,
  onClose,
  onSave,
}: {
  item: BranchMenuItem;
  branchId: string;
  line: ComposerLine | null;
  onClose: () => void;
  onSave: (line: Omit<ComposerLine, "key">) => void;
}) {
  const initial = line ?? { ...defaultSelection(item), removals: [] as string[], quantity: 1, notes: "" };
  const [variantId, setVariantId] = useState<string | null>(initial.variantId);
  const [optionIds, setOptionIds] = useState<string[]>(initial.optionIds);
  const [removals, setRemovals] = useState<string[]>(initial.removals);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [notes, setNotes] = useState(initial.notes);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function toggleOption(groupId: string, optionId: string) {
    const group = item.groups.find((g) => g.id === groupId)!;
    const inGroup = new Set(group.options.map((o) => o.id));
    setOptionIds((current) => {
      if (current.includes(optionId)) return current.filter((id) => id !== optionId);
      const others = current.filter((id) => !inGroup.has(id));
      const mine = current.filter((id) => inGroup.has(id));
      // Single choice → replace; multi → add if room.
      if (group.maxSelect === 1) return [...others, optionId];
      if (mine.length >= group.maxSelect) return current;
      return [...current, optionId];
    });
  }

  function add() {
    const draft = { itemId: item.id, variantId, optionIds, removals, quantity, notes: notes.trim() };
    startTransition(async () => {
      const result = await previewOrderAction({ branchId, lines: [draft] });
      if (!result.ok) {
        setErrors([result.message]);
        return;
      }
      const line = result.data.lines[0];
      if (!line.ok) {
        setErrors(line.errors.map((e) => e.message));
        return;
      }
      onSave(draft);
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={item.name}
      description={item.description ?? undefined}
      footer={
        <>
          <div className="flex items-center justify-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Less" disabled={quantity <= 1} onClick={() => setQuantity((q) => q - 1)}>
              <Minus />
            </Button>
            <span className="w-8 text-center text-lg font-bold" aria-live="polite">
              {quantity}
            </span>
            <Button variant="secondary" size="icon" aria-label="More" disabled={quantity >= 99} onClick={() => setQuantity((q) => q + 1)}>
              <Plus />
            </Button>
          </div>
          <Button size="lg" loading={pending} onClick={add}>
            {line ? "Update" : "Add to order"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {errors.length ? (
          <Alert title="Please check">
            <ul className="list-disc pl-4">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {item.sizes.length > 0 ? (
          <fieldset>
            <legend className="mb-2 font-bold">
              Size <span className="text-sm font-normal text-muted">· pick one</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {item.sizes.map((s) => (
                <label
                  key={s.id}
                  className="flex min-h-touch-lg cursor-pointer items-center justify-between gap-3 rounded-control border border-line px-4 has-checked:border-brand-700 has-checked:bg-brand-50"
                >
                  <span className="flex items-center gap-3">
                    <input type="radio" name="size" checked={variantId === s.id} onChange={() => setVariantId(s.id)} className="size-5 accent-brand-700" />
                    <span className="font-semibold">{s.name}</span>
                  </span>
                  <span>{formatPKR(s.price)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {item.groups.map((g) => (
          <fieldset key={g.id}>
            <legend className="mb-2 font-bold">
              {g.name} <span className="text-sm font-normal text-muted">· {groupRuleText(g.minSelect, g.maxSelect)}</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.options.map((o) => {
                const checked = optionIds.includes(o.id);
                return (
                  <label
                    key={o.id}
                    className={cn(
                      "flex min-h-touch cursor-pointer items-center justify-between gap-3 rounded-control border border-line px-4 has-checked:border-brand-700 has-checked:bg-brand-50",
                      !o.isAvailable && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type={g.maxSelect === 1 ? "radio" : "checkbox"}
                        name={`group-${g.id}`}
                        checked={checked}
                        disabled={!o.isAvailable}
                        onChange={() => toggleOption(g.id, o.id)}
                        onClick={() => g.maxSelect === 1 && checked && g.minSelect === 0 && toggleOption(g.id, o.id)}
                        className="size-5 accent-brand-700"
                      />
                      <span className={cn(!o.isAvailable && "line-through")}>{o.name}</span>
                    </span>
                    <span className="text-sm">{o.priceDelta ? `+${formatPKR(o.priceDelta)}` : o.isAvailable ? "" : "Sold out"}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        {item.removableOptions.length ? (
          <div>
            <p className="mb-2 font-bold">
              Remove <span className="text-sm font-normal text-muted">· free</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {item.removableOptions.map((r) => {
                const on = removals.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setRemovals(on ? removals.filter((x) => x !== r) : [...removals, r])}
                    className={cn(
                      "min-h-touch rounded-full border px-4 text-sm font-semibold",
                      on ? "border-danger bg-status-cancelled-bg text-danger" : "border-line-strong",
                    )}
                  >
                    {on ? `No ${r}` : r}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <Textarea label="Note for kitchen (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={300} placeholder="e.g. Less spicy" />
      </div>
    </Modal>
  );
}
