"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, Minus, Plus, X } from "lucide-react";
import { priceMenuItem } from "@/lib/menu/pricing";
import type { PageItem } from "@/lib/menu-page/data";
import { pick, rs, texts, type PageLang } from "@/lib/menu-page/i18n";
import type { PageCartLine } from "./cart";

type Group = PageItem["groups"][number];

/** "Choose 1" / "Optional · up to 3" / "Choose 1 to 2" — the rule in plain words. */
export function groupRule(g: Pick<Group, "minSelect" | "maxSelect">, lang: PageLang): { text: string; required: boolean } {
  const tx = texts(lang);
  if (g.minSelect === 0) return { text: g.maxSelect === 1 ? tx.optional : tx.chooseUpTo(g.maxSelect), required: false };
  if (g.minSelect === g.maxSelect) return { text: tx.chooseExactly(g.minSelect), required: true };
  return { text: tx.chooseRange(g.minSelect, g.maxSelect), required: true };
}

export function ItemSheet({
  item,
  lang,
  restaurantId,
  branchId,
  editing,
  canOrder,
  onClose,
  onSave,
}: {
  item: PageItem;
  lang: PageLang;
  restaurantId: string;
  branchId: string;
  /** Editing a cart line (prefills choices). */
  editing: PageCartLine | null;
  canOrder: boolean;
  onClose: () => void;
  onSave: (line: Omit<PageCartLine, "key">) => void;
}) {
  const tx = texts(lang);
  const [variantId, setVariantId] = useState<string | null>(
    editing?.variantId ?? (item.sizes.find((s) => s.isDefault) ?? (item.sizes.length === 1 ? item.sizes[0] : null))?.id ?? null,
  );
  const [optionIds, setOptionIds] = useState<string[]>(
    editing?.optionIds ?? item.groups.flatMap((g) => g.options.filter((o) => o.isDefault && o.isAvailable).map((o) => o.id)),
  );
  const [removals, setRemovals] = useState<string[]>(editing?.removals ?? []);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [quantity, setQuantity] = useState(editing?.quantity ?? 1);
  const [showErrors, setShowErrors] = useState(false);

  const result = priceMenuItem(restaurantId, branchId, item, { variantId, modifierOptionIds: optionIds, removals, quantity });
  const firstError = result.ok ? null : result.errors[0];
  const errorText = !firstError
    ? null
    : firstError.code === "SIZE_REQUIRED" || firstError.code === "INVALID_SIZE"
      ? tx.pickSize
      : firstError.groupName
        ? tx.pickGroup(pick(lang, firstError.groupName, item.groups.find((g) => g.id === firstError.groupId)?.nameUr))
        : tx.unavailable;

  function toggleOption(g: Group, id: string) {
    setOptionIds((cur) => {
      const inGroup = new Set(g.options.map((o) => o.id));
      const chosen = cur.filter((x) => inGroup.has(x));
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (g.maxSelect === 1) return [...cur.filter((x) => !inGroup.has(x)), id]; // radio
      if (chosen.length >= g.maxSelect) return cur; // UI enforces the max
      return [...cur, id];
    });
  }

  const sizeRequired = item.sizes.length > 0;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pick(lang, item.name, item.nameUr)}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-panel bg-surface sm:rounded-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" aria-hidden />
          <div className="relative mb-4">
            {item.imageUrl ? (
              <Image
                src={item.imageUrl}
                alt=""
                width={640}
                height={360}
                sizes="(max-width: 512px) 100vw, 512px"
                className="aspect-video w-full rounded-card object-cover"
              />
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label={tx.close}
              className={`${item.imageUrl ? "absolute end-2 top-2" : "ms-auto"} flex size-touch items-center justify-center rounded-full bg-surface shadow-raised`}
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <h2 className="text-xl font-bold">{pick(lang, item.name, item.nameUr)}</h2>
          {item.description ? <p className="mt-1 text-sm text-muted">{pick(lang, item.description, item.descriptionUr)}</p> : null}

          {sizeRequired ? (
            <fieldset className="mt-5">
              <legend className="flex w-full items-center justify-between font-bold">
                <span>{tx.chooseSize}</span>
                <span className="rounded-md bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">{tx.required}</span>
              </legend>
              <div className="mt-2 flex flex-col gap-2">
                {item.sizes.map((s) => {
                  const on = variantId === s.id;
                  return (
                    <label
                      key={s.id}
                      className={`flex min-h-touch-lg cursor-pointer items-center gap-3 rounded-card border px-4 ${on ? "border-2 border-brand-700 bg-brand-50" : "border-line"}`}
                    >
                      <input type="radio" name="size" className="size-5 accent-brand-700" checked={on} onChange={() => setVariantId(s.id)} />
                      <span className="flex-1">{pick(lang, s.name, s.nameUr)}</span>
                      <span className="font-semibold" dir="ltr">{rs(s.price)}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {item.groups.map((g) => {
            const rule = groupRule(g, lang);
            const chosen = optionIds.filter((id) => g.options.some((o) => o.id === id)).length;
            const radio = g.maxSelect === 1 && g.minSelect === 1;
            return (
              <fieldset key={g.id} className="mt-5">
                <legend className="flex w-full items-center justify-between font-bold">
                  <span>{pick(lang, g.name, g.nameUr)}</span>
                  {rule.required ? (
                    <span className="rounded-md bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">{rule.text}</span>
                  ) : (
                    <span className="text-sm font-normal text-muted">{rule.text}</span>
                  )}
                </legend>
                <div className="mt-2 flex flex-col gap-2">
                  {g.options.map((o) => {
                    const on = optionIds.includes(o.id);
                    const blocked = !o.isAvailable || (!on && !radio && g.maxSelect > 1 && chosen >= g.maxSelect);
                    return (
                      <label
                        key={o.id}
                        className={`flex min-h-touch-lg items-center gap-3 rounded-card border px-4 ${on ? "border-2 border-brand-700 bg-brand-50" : "border-line"} ${blocked ? "opacity-50" : "cursor-pointer"}`}
                      >
                        <input
                          type={radio ? "radio" : "checkbox"}
                          name={`g-${g.id}`}
                          className="size-5 accent-brand-700"
                          checked={on}
                          disabled={blocked}
                          onChange={() => toggleOption(g, o.id)}
                        />
                        <span className="flex-1">
                          {pick(lang, o.name, o.nameUr)}
                          {!o.isAvailable ? <span className="ms-2 text-xs text-muted">· {tx.unavailable}</span> : null}
                        </span>
                        {o.priceDelta ? (
                          <span dir="ltr">+ {rs(o.priceDelta)}</span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          {item.removableOptions.length ? (
            <fieldset className="mt-5">
              <legend className="flex w-full items-center justify-between font-bold">
                <span>{tx.removeAnything}</span>
                <span className="text-sm font-normal text-muted">{tx.free}</span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {item.removableOptions.map((r) => {
                  const on = removals.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRemovals((cur) => (on ? cur.filter((x) => x !== r) : [...cur, r]))}
                      className={`flex min-h-touch items-center gap-2 rounded-full border px-4 ${on ? "border-2 border-status-cancelled-fg bg-status-cancelled-bg text-status-cancelled-fg" : "border-line"}`}
                    >
                      <span className={`flex size-5 items-center justify-center rounded border ${on ? "border-status-cancelled-fg bg-status-cancelled-fg text-white" : "border-line-strong"}`}>
                        {on ? <Check aria-hidden className="size-4" /> : null}
                      </span>
                      {tx.no(r)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <label className="mt-5 block">
            <span className="font-bold">{tx.note}</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 200))}
              rows={2}
              maxLength={200}
              placeholder={tx.notePlaceholder}
              className="mt-2 w-full rounded-card border border-line-strong p-3 text-base"
            />
          </label>
        </div>

        <div className="border-t border-line bg-surface p-3">
          {showErrors && errorText ? (
            <p role="alert" className="mb-2 text-sm font-semibold text-danger">
              {errorText}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <div className="flex h-touch-lg items-center rounded-card border border-line-strong" dir="ltr">
              <button type="button" aria-label="−" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="flex size-touch items-center justify-center">
                <Minus aria-hidden className="size-5" />
              </button>
              <span className="w-8 text-center text-lg font-semibold" aria-live="polite">
                {quantity}
              </span>
              <button type="button" aria-label="+" onClick={() => setQuantity((q) => Math.min(99, q + 1))} className="flex size-touch items-center justify-center">
                <Plus aria-hidden className="size-5" />
              </button>
            </div>
            <button
              type="button"
              disabled={!canOrder}
              onClick={() => {
                if (!result.ok) {
                  setShowErrors(true);
                  return;
                }
                onSave({ itemId: item.id, variantId, optionIds: result.line.options.map((o) => o.id), removals, quantity, notes: notes.trim() });
              }}
              className="flex h-touch-lg flex-1 items-center justify-center rounded-card bg-brand-700 px-3 text-base font-bold text-white disabled:bg-line disabled:text-muted"
            >
              {result.ok
                ? (editing ? tx.update : tx.addToOrder)(rs(result.line.lineTotal))
                : tx.add}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
