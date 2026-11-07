"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { GroupForm } from "@/components/menu/group-form";
import { ItemPhoto } from "@/components/menu/item-photo";
import { MenuImagePicker } from "@/components/menu/menu-image-picker";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipInput } from "@/components/ui/chip-input";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { DragHandle, SortableList } from "@/components/ui/sortable-list";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { UrduText } from "@/components/ui/urdu-text";
import { archiveItem, saveItem } from "@/lib/menu/actions";
import type { EditorItem, LibraryGroup } from "@/lib/menu/queries";
import { formatPKR, paisaToInput, parseRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import { groupRuleText, MENU_TAGS, TAG_LABELS, type ItemInput, type MenuTag } from "@/lib/validation/menu";

type SizeRow = { id: string; savedId?: string; name: string; nameUr: string; price: string; isDefault: boolean };
type BranchRow = {
  branchId: string;
  name: string;
  sold: boolean;
  inStock: boolean;
  custom: boolean;
  price: string;
  sizePrices: Record<string, string>;
};
type FormState = {
  categoryId: string;
  name: string;
  nameUr: string;
  description: string;
  descriptionUr: string;
  imageUrl: string;
  isActive: boolean;
  tags: MenuTag[];
  hasSizes: boolean;
  basePrice: string;
  sizes: SizeRow[];
  groupIds: string[];
  removableOptions: string[];
  aliases: string[];
  prepTime: string;
  branches: BranchRow[];
};

function initialState(
  item: EditorItem | null,
  defaultCategoryId: string,
  branches: { id: string; name: string }[],
): FormState {
  const sizes: SizeRow[] = (item?.sizes ?? []).map((s) => ({
    id: s.id,
    savedId: s.id,
    name: s.name,
    nameUr: s.nameUr,
    price: paisaToInput(s.price),
    isDefault: s.isDefault,
  }));
  return {
    categoryId: item?.categoryId ?? defaultCategoryId,
    name: item?.name ?? "",
    nameUr: item?.nameUr ?? "",
    description: item?.description ?? "",
    descriptionUr: item?.descriptionUr ?? "",
    imageUrl: item?.imageUrl ?? "",
    isActive: item?.isActive ?? true,
    tags: (item?.tags ?? []).filter((t): t is MenuTag => (MENU_TAGS as readonly string[]).includes(t)),
    hasSizes: sizes.length > 0,
    basePrice: paisaToInput(item?.basePrice),
    sizes,
    groupIds: item?.groupIds ?? [],
    removableOptions: item?.removableOptions ?? [],
    aliases: item?.aliases ?? [],
    prepTime: item?.prepTimeMinutes != null ? String(item.prepTimeMinutes) : "",
    branches: branches.map((b) => {
      const s = item?.branches.find((x) => x.branchId === b.id);
      const sizePrices = Object.fromEntries(
        Object.entries(s?.sizePrices ?? {}).map(([k, v]) => [k, paisaToInput(v)]),
      );
      return {
        branchId: b.id,
        name: b.name,
        sold: !(s?.isHidden ?? false),
        inStock: s?.isAvailable ?? true,
        custom: s?.priceOverride != null || Object.keys(sizePrices).length > 0,
        price: paisaToInput(s?.priceOverride),
        sizePrices,
      };
    }),
  };
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </Card>
  );
}

/** How the item will look to customers. */
function ItemPreview({ form, groups }: { form: FormState; groups: LibraryGroup[] }) {
  const sizes = form.sizes
    .map((s) => ({ name: s.name || "Size", price: parseRupees(s.price) }))
    .filter((s) => s.price !== null);
  const base = parseRupees(form.basePrice);
  const attached = form.groupIds.map((id) => groups.find((g) => g.id === id)).filter((g): g is LibraryGroup => !!g);
  return (
    <Card padding="none" className="overflow-hidden">
      <p className="border-b border-line bg-subtle px-4 py-2 text-xs font-bold tracking-wide text-muted uppercase">
        Customers see
      </p>
      <div className="flex flex-col gap-3 p-4">
        {form.imageUrl ? <ItemPhoto url={form.imageUrl} size={320} className="aspect-square w-full" /> : null}
        <div>
          <div className="flex flex-wrap gap-1">
            {form.tags.map((t) => (
              <Badge key={t} tone="brand">
                {TAG_LABELS[t]}
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-lg font-bold">{form.name || "Item name"}</p>
          {form.nameUr ? <UrduText className="block text-base">{form.nameUr}</UrduText> : null}
          {form.description ? <p className="mt-1 text-sm text-muted">{form.description}</p> : null}
        </div>
        {form.hasSizes ? (
          <ul className="flex flex-col gap-1 text-sm">
            {sizes.map((s, i) => (
              <li key={i} className="flex justify-between rounded-control border border-line px-3 py-2">
                <span>{s.name}</span>
                <span className="font-semibold">{formatPKR(s.price!)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-lg font-bold">{base !== null ? formatPKR(base) : "Rs —"}</p>
        )}
        {attached.map((g) => (
          <div key={g.id} className="text-sm">
            <p className="font-semibold">
              {g.name} <span className="font-normal text-muted">· {groupRuleText(g.minSelect, g.maxSelect)}</span>
            </p>
            <p className="text-muted">
              {g.options.map((o) => (o.priceDelta ? `${o.name} +${formatPKR(o.priceDelta)}` : o.name)).join(" · ")}
            </p>
          </div>
        ))}
        {form.removableOptions.length ? (
          <p className="text-sm text-muted">Can be removed: {form.removableOptions.join(", ")}</p>
        ) : null}
        {!form.isActive ? <Alert tone="info">Hidden from the menu</Alert> : null}
      </div>
    </Card>
  );
}

export function ItemEditor({
  restaurantId,
  item,
  defaultCategoryId,
  categories,
  groups: initialGroups,
  branches,
  canEditPrices,
}: {
  restaurantId: string;
  item: EditorItem | null;
  defaultCategoryId?: string;
  categories: { id: string; name: string }[];
  groups: LibraryGroup[];
  branches: { id: string; name: string }[];
  canEditPrices: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState(() => initialState(item, defaultCategoryId ?? categories[0]?.id ?? "", branches));
  const [initialJson] = useState(() => JSON.stringify(form));
  const [groups, setGroups] = useState(initialGroups);
  const [groupDrawer, setGroupDrawer] = useState<LibraryGroup | "new" | null>(null);
  const [pickGroupId, setPickGroupId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [saving, startSaving] = useTransition();
  const leaving = useRef(false);

  const dirty = JSON.stringify(form) !== initialJson;
  const category = categories.find((c) => c.id === form.categoryId);

  // Unsaved-changes warning: browser close/reload and in-app links.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (leaving.current) return;
      const link = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.origin !== window.location.origin) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        leaving.current = true;
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setSize = (id: string, patch: Partial<SizeRow>) =>
    set("sizes", form.sizes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const setBranch = (branchId: string, patch: Partial<BranchRow>) =>
    set("branches", form.branches.map((b) => (b.branchId === branchId ? { ...b, ...patch } : b)));

  const attachedGroups = useMemo(
    () => form.groupIds.map((id) => groups.find((g) => g.id === id)).filter((g): g is LibraryGroup => !!g),
    [form.groupIds, groups],
  );
  const availableGroups = groups.filter((g) => !form.groupIds.includes(g.id));

  function addSize() {
    set("sizes", [
      ...form.sizes,
      { id: crypto.randomUUID(), name: "", nameUr: "", price: "", isDefault: form.sizes.length === 0 },
    ]);
  }

  /** Form → server input, collecting price typos as field errors. */
  function toInput(): { input: ItemInput | null; errors: Record<string, string> } {
    const found: Record<string, string> = {};
    const money = (text: string, key: string, required: boolean) => {
      if (!text.trim()) {
        if (required) found[key] = "Please enter a price";
        return null;
      }
      const v = parseRupees(text);
      if (v === null) found[key] = "Enter a price like 850";
      return v;
    };
    const basePrice = form.hasSizes ? null : money(form.basePrice, "basePrice", true);
    const sizes = form.hasSizes
      ? form.sizes.map((s, i) => ({
          id: s.savedId,
          key: s.id,
          name: s.name,
          nameUr: s.nameUr,
          price: money(s.price, `sizes.${i}.price`, true) ?? 0,
          isDefault: s.isDefault,
        }))
      : [];
    const prep = form.prepTime.trim() === "" ? null : Number(form.prepTime);
    if (prep !== null && (!Number.isInteger(prep) || prep < 0)) found.prepTimeMinutes = "Enter minutes, e.g. 15";
    const branchInput = form.branches.map((b, bi) => ({
      branchId: b.branchId,
      isHidden: !b.sold,
      isAvailable: b.inStock,
      priceOverride: b.custom && !form.hasSizes ? money(b.price, `branches.${bi}.price`, false) : null,
      sizePrices:
        b.custom && form.hasSizes
          ? form.sizes.flatMap((s) => {
              const v = money(b.sizePrices[s.id] ?? "", `branches.${bi}.${s.id}`, false);
              return v === null ? [] : [{ sizeKey: s.id, price: v }];
            })
          : [],
    }));
    if (Object.keys(found).length) return { input: null, errors: found };
    return {
      errors: {},
      input: {
        id: item?.id,
        categoryId: form.categoryId,
        name: form.name,
        nameUr: form.nameUr,
        description: form.description,
        descriptionUr: form.descriptionUr,
        imageUrl: form.imageUrl,
        hasSizes: form.hasSizes,
        basePrice,
        isActive: form.isActive,
        tags: form.tags,
        prepTimeMinutes: prep,
        aliases: form.aliases,
        removableOptions: form.removableOptions,
        sizes,
        groupIds: form.groupIds,
        branches: branchInput,
      },
    };
  }

  function save() {
    setFormError(null);
    const { input, errors: local } = toInput();
    if (!input) {
      setErrors(local);
      setFormError("Please check the highlighted fields.");
      return;
    }
    startSaving(async () => {
      const result = await saveItem(input);
      if (!result.ok) {
        setFormError(result.error);
        setErrors(result.fieldErrors ?? {});
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      leaving.current = true;
      toast({ title: item ? `${form.name} saved` : `${form.name} added to the menu` });
      router.push("/menu");
      router.refresh();
    });
  }

  function archive() {
    if (!item) return;
    startSaving(async () => {
      const result = await archiveItem(item.id);
      if (!result.ok) {
        setFormError(result.error);
        setConfirmArchive(false);
        return;
      }
      leaving.current = true;
      toast({ title: `${item.name} removed from the menu` });
      router.push("/menu");
      router.refresh();
    });
  }

  const priceDisabled = !canEditPrices;

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div className="flex items-start gap-3">
        <Link href="/menu" aria-label="Back to menu" className={buttonVariants({ variant: "secondary", size: "icon" })}>
          <ArrowLeft aria-hidden />
        </Link>
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">{item ? "Edit item" : "Add item"}</h1>
          <p className="text-muted">
            {category?.name ?? "Menu"} · {form.name || "New item"}
          </p>
        </div>
      </div>

      {formError ? <Alert>{formError}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Basic details">
            <div className="flex flex-col gap-5 sm:flex-row">
              <MenuImagePicker
                restaurantId={restaurantId}
                value={form.imageUrl}
                onChange={(url) => set("imageUrl", url)}
                error={errors.imageUrl}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <Input label="Item name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Zinger Burger" required error={errors.name} />
                <Input
                  label="Urdu name (optional)"
                  value={form.nameUr}
                  onChange={(e) => set("nameUr", e.target.value)}
                  dir="rtl"
                  lang="ur"
                  className="font-urdu"
                  error={errors.nameUr}
                />
                <Textarea
                  label="Short description (customers see this)"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="e.g. Crispy chicken fillet, lettuce, mayo"
                  rows={2}
                  error={errors.description}
                />
                <Textarea
                  label="Urdu description (optional)"
                  value={form.descriptionUr}
                  onChange={(e) => set("descriptionUr", e.target.value)}
                  dir="rtl"
                  lang="ur"
                  className="font-urdu"
                  rows={2}
                  error={errors.descriptionUr}
                />
                <Select
                  label="Category"
                  value={form.categoryId}
                  onChange={(e) => set("categoryId", e.target.value)}
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  error={errors.categoryId}
                />
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">Tags</p>
              <div className="flex flex-wrap gap-2">
                {MENU_TAGS.map((t) => {
                  const on = form.tags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("tags", on ? form.tags.filter((x) => x !== t) : [...form.tags, t])}
                      className={cn(
                        "flex min-h-touch items-center gap-1 rounded-full border px-4 text-sm font-semibold",
                        on ? "border-brand-700 bg-brand-50 text-brand-800" : "border-line-strong bg-surface text-muted",
                      )}
                    >
                      {on ? <Check aria-hidden className="size-4" /> : null}
                      {TAG_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-card border border-status-ready-border bg-status-ready-bg/40 p-3">
              <Switch
                tone="success"
                size="lg"
                checked={form.isActive}
                onCheckedChange={(v) => set("isActive", v)}
                label="Show on menu"
                description={form.isActive ? "Customers and the WhatsApp bot can see it" : "Hidden from customers"}
              />
            </div>
          </Section>

          <Section title="Price" hint={priceDisabled ? "Only owners and managers can change prices." : undefined}>
            <Switch
              checked={form.hasSizes}
              onCheckedChange={(v) => {
                set("hasSizes", v);
                if (v && form.sizes.length === 0) {
                  setForm((f) => ({
                    ...f,
                    hasSizes: true,
                    sizes: [{ id: crypto.randomUUID(), name: "", nameUr: "", price: f.basePrice, isDefault: true }],
                  }));
                }
              }}
              disabled={priceDisabled}
              label="This item has sizes"
              description="e.g. Small, Medium, Large or Half, Full"
            />
            {!form.hasSizes ? (
              <MoneyInput
                label="Price"
                value={form.basePrice}
                onChange={(e) => set("basePrice", e.target.value)}
                placeholder="550"
                disabled={priceDisabled}
                wrapperClassName="max-w-56"
                error={errors.basePrice}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted">Customer must pick one. Each size has its full price.</p>
                {errors.sizes ? <p className="text-sm text-danger">{errors.sizes}</p> : null}
                <SortableList id="item-sizes" items={form.sizes} onReorder={(s) => set("sizes", s)} disabled={priceDisabled} className="flex flex-col gap-2">
                  {(s, { handle }) => {
                    const i = form.sizes.findIndex((x) => x.id === s.id);
                    return (
                      <div className="flex flex-wrap items-start gap-2 rounded-card border border-line p-2 sm:flex-nowrap">
                        <DragHandle handle={handle} label={`Move ${s.name || "size"}`} />
                        <Input
                          aria-label="Size name"
                          value={s.name}
                          onChange={(e) => setSize(s.id, { name: e.target.value })}
                          placeholder="e.g. Large"
                          wrapperClassName="min-w-0 flex-1"
                          error={errors[`sizes.${i}.name`]}
                        />
                        <MoneyInput
                          aria-label={`${s.name || "Size"} price`}
                          value={s.price}
                          onChange={(e) => setSize(s.id, { price: e.target.value })}
                          placeholder="899"
                          disabled={priceDisabled}
                          wrapperClassName="w-36"
                          error={errors[`sizes.${i}.price`]}
                        />
                        <button
                          type="button"
                          aria-pressed={s.isDefault}
                          onClick={() => set("sizes", form.sizes.map((x) => ({ ...x, isDefault: x.id === s.id ? !s.isDefault : false })))}
                          className={cn(
                            "min-h-touch rounded-control border px-3 text-sm font-semibold",
                            s.isDefault ? "border-brand-700 bg-brand-50 text-brand-800" : "border-line-strong text-muted",
                          )}
                        >
                          Default
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${s.name || "size"}`}
                          className="text-danger"
                          disabled={priceDisabled}
                          onClick={() => set("sizes", form.sizes.filter((x) => x.id !== s.id))}
                        >
                          <X />
                        </Button>
                      </div>
                    );
                  }}
                </SortableList>
                <Button variant="secondary" icon={<Plus />} onClick={addSize} disabled={priceDisabled || form.sizes.length >= 10} className="self-start border-dashed text-brand-700">
                  Add size
                </Button>
              </div>
            )}
          </Section>

          <Section title="Extras / Choices" hint="Things customers can add or must choose, like toppings or a drink.">
            {attachedGroups.length ? (
              <SortableList
                id="item-groups"
                items={attachedGroups}
                onReorder={(list) => set("groupIds", list.map((g) => g.id))}
                className="flex flex-col gap-3"
              >
                {(g, { handle }) => (
                  <div className="rounded-card border border-line">
                    <div className="flex items-start gap-1 p-2">
                      <DragHandle handle={handle} label={`Move ${g.name}`} />
                      <div className="min-w-0 flex-1 py-2">
                        <p className="font-bold">{g.name}</p>
                        <p className="text-sm text-brand-800">{groupRuleText(g.minSelect, g.maxSelect)}</p>
                      </div>
                      <Button variant="ghost" size="icon" aria-label={`Edit ${g.name}`} onClick={() => setGroupDrawer(g)}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${g.name} from this item`}
                        className="text-danger"
                        onClick={() => set("groupIds", form.groupIds.filter((id) => id !== g.id))}
                      >
                        <X />
                      </Button>
                    </div>
                    <ul className="divide-y divide-line border-t border-line text-sm">
                      {g.options.map((o) => (
                        <li key={o.id} className={cn("flex justify-between px-4 py-2.5", !o.isAvailable && "text-muted line-through")}>
                          <span>
                            {o.name}
                            {o.isDefault ? <span className="text-muted"> · default</span> : null}
                          </span>
                          <span className="font-semibold">{o.priceDelta ? `+ ${formatPKR(o.priceDelta)}` : "Free"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </SortableList>
            ) : (
              <p className="text-sm text-muted">No extras yet.</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              {availableGroups.length ? (
                <>
                  <Select
                    label="Add from your extras library"
                    value={pickGroupId}
                    onChange={(e) => setPickGroupId(e.target.value)}
                    placeholder="Choose a group"
                    options={availableGroups.map((g) => ({ value: g.id, label: `${g.name} (${groupRuleText(g.minSelect, g.maxSelect)})` }))}
                    wrapperClassName="flex-1"
                  />
                  <Button
                    variant="secondary"
                    icon={<Plus />}
                    disabled={!pickGroupId}
                    onClick={() => {
                      set("groupIds", [...form.groupIds, pickGroupId]);
                      setPickGroupId("");
                    }}
                  >
                    Add
                  </Button>
                </>
              ) : null}
              <Button variant="secondary" icon={<Layers />} onClick={() => setGroupDrawer("new")} className="border-dashed text-brand-700">
                Create new group
              </Button>
            </div>
          </Section>

          <Section title="Can be removed" hint="Free — the customer can ask to leave these out.">
            <ChipInput
              label="Things that can be removed"
              value={form.removableOptions}
              onChange={(v) => set("removableOptions", v)}
              placeholder="e.g. Onion, Olives, Mayo"
              maxLength={40}
              error={errors.removableOptions}
            />
          </Section>

          <Section title="Other names customers use">
            <ChipInput
              label="Other names"
              value={form.aliases}
              onChange={(v) => set("aliases", v)}
              placeholder="e.g. zinger, zngr, زنگر"
              hint="Add short names, spellings, or Urdu names customers might type on WhatsApp."
              error={errors.aliases}
            />
          </Section>

          <Section title="Branches" hint="Where this item is sold, stock, and branch-only prices.">
            <ul className="flex flex-col gap-3">
              {form.branches.map((b, bi) => (
                <li key={b.branchId} className="flex flex-col gap-3 rounded-card border border-line p-3">
                  <p className="font-bold">{b.name}</p>
                  <div className="flex flex-wrap gap-x-6">
                    <Switch checked={b.sold} onCheckedChange={(sold) => setBranch(b.branchId, { sold })} label={b.sold ? "Sold here" : "Not sold here"} />
                    <Switch
                      tone="success"
                      checked={b.inStock}
                      onCheckedChange={(inStock) => setBranch(b.branchId, { inStock })}
                      label={b.inStock ? "In stock" : "Out of stock"}
                      disabled={!b.sold}
                    />
                    <Switch
                      checked={b.custom}
                      onCheckedChange={(custom) => setBranch(b.branchId, { custom })}
                      label="Different price here"
                      disabled={!b.sold || priceDisabled}
                    />
                  </div>
                  {b.custom && b.sold ? (
                    form.hasSizes ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {form.sizes.map((s) => (
                          <MoneyInput
                            key={s.id}
                            label={s.name || "Size"}
                            value={b.sizePrices[s.id] ?? ""}
                            onChange={(e) => setBranch(b.branchId, { sizePrices: { ...b.sizePrices, [s.id]: e.target.value } })}
                            placeholder={s.price || "Same as normal"}
                            disabled={priceDisabled}
                            hint="Leave empty to use the normal price"
                            error={errors[`branches.${bi}.${s.id}`]}
                          />
                        ))}
                      </div>
                    ) : (
                      <MoneyInput
                        label="Price at this branch"
                        value={b.price}
                        onChange={(e) => setBranch(b.branchId, { price: e.target.value })}
                        placeholder={form.basePrice || "Same as normal"}
                        disabled={priceDisabled}
                        hint="Leave empty to use the normal price"
                        wrapperClassName="max-w-56"
                        error={errors[`branches.${bi}.price`]}
                      />
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Prep time">
            <Input
              label="Minutes to prepare (optional)"
              type="number"
              inputMode="numeric"
              min={0}
              max={240}
              value={form.prepTime}
              onChange={(e) => set("prepTime", e.target.value)}
              placeholder="15"
              wrapperClassName="max-w-56"
              hint="Helps tell customers when their order will be ready."
              error={errors.prepTimeMinutes}
            />
          </Section>
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <ItemPreview form={form} groups={groups} />
        </aside>
      </div>

      {/* Sticky action bar (sits above the mobile bottom nav) */}
      <div className="fixed inset-x-0 bottom-[calc(var(--spacing-touch-lg)+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-[var(--spacing-sidebar)] lg:px-8">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          {item ? (
            <Button variant="ghost" icon={<Trash2 />} className="text-danger" onClick={() => setConfirmArchive(true)}>
              <span className="hidden sm:inline">Remove item</span>
            </Button>
          ) : null}
          <span className="hidden flex-1 text-sm text-muted sm:block">{dirty ? "Unsaved changes" : ""}</span>
          <Link href="/menu" className={buttonVariants({ variant: "secondary", className: "ml-auto sm:ml-0" })}>
            Cancel
          </Link>
          <Button icon={<Check />} loading={saving} onClick={save} className="px-6">
            Save item
          </Button>
        </div>
      </div>

      <Drawer
        open={groupDrawer !== null}
        onClose={() => setGroupDrawer(null)}
        title={groupDrawer === "new" ? "New extras group" : `Edit ${groupDrawer?.name ?? "group"}`}
        size="lg"
      >
        {groupDrawer ? (
          <GroupForm
            key={groupDrawer === "new" ? "new" : groupDrawer.id}
            group={groupDrawer === "new" ? null : groupDrawer}
            onCancel={() => setGroupDrawer(null)}
            onSaved={(g) => {
              setGroups((list) => (list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [...list, g]));
              if (!form.groupIds.includes(g.id)) set("groupIds", [...form.groupIds, g.id]);
              setGroupDrawer(null);
            }}
          />
        ) : null}
      </Drawer>

      <Modal
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        tone="danger"
        icon={<Trash2 />}
        title={`Remove ${item?.name ?? "item"}?`}
        description="It disappears from the menu and WhatsApp. Past orders and reports keep it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmArchive(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={saving} onClick={archive}>
              Remove item
            </Button>
          </>
        }
      />
    </div>
  );
}
