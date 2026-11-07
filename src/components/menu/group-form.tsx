"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DragHandle, SortableList } from "@/components/ui/sortable-list";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { saveGroup } from "@/lib/menu/actions";
import type { LibraryGroup } from "@/lib/menu/queries";
import { paisaToInput, parseRupees } from "@/lib/money";
import { groupRuleText } from "@/lib/validation/menu";

type OptionRow = {
  id: string; // sortable key: real id or "new-…"
  savedId?: string;
  name: string;
  nameUr: string;
  price: string;
  isDefault: boolean;
  isAvailable: boolean;
};

function NumberBox({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
}) {
  return (
    <input
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={min}
      max={50}
      value={value}
      onChange={(e) => onChange(Math.max(min, Math.min(50, Number(e.target.value) || 0)))}
      className="h-touch w-16 rounded-control border border-line-strong bg-surface text-center text-base font-semibold focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20 focus:outline-none"
    />
  );
}

/**
 * Create or edit a reusable Extras/Choices group, in plain words:
 * "Customer can pick at least [0] and up to [3]".
 */
export function GroupForm({
  group,
  onSaved,
  onCancel,
}: {
  group: LibraryGroup | null;
  onSaved: (group: LibraryGroup) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(group?.name ?? "");
  const [nameUr, setNameUr] = useState(group?.nameUr ?? "");
  const [min, setMin] = useState(group?.minSelect ?? 0);
  const [max, setMax] = useState(group?.maxSelect ?? 1);
  const [options, setOptions] = useState<OptionRow[]>(
    group?.options.map((o) => ({
      id: o.id,
      savedId: o.id,
      name: o.name,
      nameUr: o.nameUr ?? "",
      price: paisaToInput(o.priceDelta),
      isDefault: o.isDefault,
      isAvailable: o.isAvailable,
    })) ?? [{ id: crypto.randomUUID(), name: "", nameUr: "", price: "0", isDefault: false, isAvailable: true }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const required = min > 0;
  const update = (id: string, patch: Partial<OptionRow>) =>
    setOptions((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  function save() {
    setFormError(null);
    const local: Record<string, string> = {};
    const parsed = options.map((o, i) => {
      const price = o.price.trim() === "" ? 0 : parseRupees(o.price);
      if (price === null) local[`options.${i}.priceDelta`] = "Enter an amount like 150";
      return { ...o, priceDelta: price ?? 0 };
    });
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    startSaving(async () => {
      const result = await saveGroup({
        id: group?.id,
        name,
        nameUr,
        minSelect: min,
        maxSelect: max,
        options: parsed.map((o) => ({
          id: o.savedId,
          name: o.name,
          nameUr: o.nameUr,
          priceDelta: o.priceDelta,
          isDefault: o.isDefault,
          isAvailable: o.isAvailable,
        })),
      });
      if (!result.ok) {
        setFormError(result.error);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      toast({ title: group ? "Extras group saved" : `${name} created` });
      onSaved({
        id: result.data!.id,
        name: name.trim(),
        nameUr: nameUr.trim() || null,
        minSelect: min,
        maxSelect: max,
        options: parsed.map((o) => ({
          id: o.savedId ?? o.id,
          name: o.name.trim(),
          nameUr: o.nameUr.trim() || null,
          priceDelta: o.priceDelta,
          isDefault: o.isDefault,
          isAvailable: o.isAvailable,
        })),
        usedBy: group?.usedBy ?? [],
      });
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {formError ? <Alert>{formError}</Alert> : null}
      {group && group.usedBy.length > 1 ? (
        <Alert tone="info">
          Used by {group.usedBy.length} items. Changes here apply to all of them.
        </Alert>
      ) : null}

      <Input
        label="Group name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Pizza Extras, Choose your drink"
        error={errors.name}
      />
      <Input
        label="Urdu name (optional)"
        value={nameUr}
        onChange={(e) => setNameUr(e.target.value)}
        dir="rtl"
        lang="ur"
        className="font-urdu"
      />

      <div className="flex flex-col gap-3 rounded-card border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-semibold">Rules</p>
          <Tabs
            variant="segmented"
            aria-label="Optional or required"
            value={required ? "required" : "optional"}
            onValueChange={(v) => {
              if (v === "required") {
                setMin(Math.max(1, min));
                setMax(Math.max(max, 1));
              } else setMin(0);
            }}
            items={[
              { value: "optional", label: "Optional" },
              { value: "required", label: "Required" },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-base">
          Customer can pick at least
          <NumberBox
            label="At least"
            value={min}
            min={0}
            onChange={(v) => {
              setMin(v);
              if (v > max) setMax(v);
            }}
          />
          and up to
          <NumberBox label="Up to" value={max} min={1} onChange={(v) => setMax(Math.max(v, min, 1))} />
        </div>
        <p className="text-sm font-semibold text-brand-800">{groupRuleText(min, max)}</p>
        {errors.minSelect || errors.maxSelect ? (
          <p className="text-sm text-danger">{errors.minSelect ?? errors.maxSelect}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-semibold">Choices</p>
        {errors.options ? <p className="text-sm text-danger">{errors.options}</p> : null}
        <SortableList id="group-options" items={options} onReorder={setOptions} className="flex flex-col gap-2">
          {(o, { handle }) => {
            const i = options.findIndex((x) => x.id === o.id);
            return (
              <div className="rounded-card border border-line bg-surface p-2">
                <div className="flex items-start gap-1">
                  <DragHandle handle={handle} label={`Move ${o.name || "choice"}`} />
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_9rem]">
                    <Input
                      aria-label="Choice name"
                      value={o.name}
                      onChange={(e) => update(o.id, { name: e.target.value })}
                      placeholder="e.g. Extra Cheese"
                      error={errors[`options.${i}.name`]}
                    />
                    <MoneyInput
                      aria-label="Extra price"
                      prefix="+Rs"
                      value={o.price}
                      onChange={(e) => update(o.id, { price: e.target.value })}
                      placeholder="0"
                      className="pl-14"
                      error={errors[`options.${i}.priceDelta`]}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${o.name || "choice"}`}
                    onClick={() => setOptions((list) => list.filter((x) => x.id !== o.id))}
                    disabled={options.length === 1}
                    className="text-danger"
                  >
                    <X />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-x-4 pl-11">
                  <Switch
                    checked={o.isDefault}
                    onCheckedChange={(isDefault) => update(o.id, { isDefault })}
                    label="Picked by default"
                  />
                  <Switch
                    checked={o.isAvailable}
                    onCheckedChange={(isAvailable) => update(o.id, { isAvailable })}
                    label={o.isAvailable ? "Available" : "Not available"}
                  />
                </div>
              </div>
            );
          }}
        </SortableList>
        <Button
          variant="secondary"
          icon={<Plus />}
          className="self-start border-dashed text-brand-700"
          onClick={() =>
            setOptions((list) => [
              ...list,
              { id: crypto.randomUUID(), name: "", nameUr: "", price: "0", isDefault: false, isAvailable: true },
            ])
          }
        >
          Add choice
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="lg" loading={saving} onClick={save}>
          {group ? "Save group" : "Create group"}
        </Button>
      </div>
    </div>
  );
}
