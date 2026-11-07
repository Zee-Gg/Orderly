"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { BookOpen, Camera, ChartNoAxesColumnIncreasing, Layers, MoreHorizontal, Pencil, Plus, Search } from "lucide-react";
import { ItemPhoto } from "@/components/menu/item-photo";
import { StockToggle } from "@/components/menu/stock-toggle";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { DragHandle, SortableList } from "@/components/ui/sortable-list";
import { useToast } from "@/components/ui/toast";
import { reorderCategories, reorderItems, setItemStock } from "@/lib/menu/actions";
import type { BoardCategory, BoardItem } from "@/lib/menu/queries";
import { formatPKR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CategoryDialog, type CategoryDraft } from "./category-dialog";

type ItemsAction =
  | { type: "stock"; id: string; inStock: boolean }
  | { type: "order"; categoryId: string; ids: string[] };

function itemsReducer(items: BoardItem[], action: ItemsAction): BoardItem[] {
  if (action.type === "stock") {
    return items.map((i) => (i.id === action.id ? { ...i, inStock: action.inStock } : i));
  }
  const rank = new Map(action.ids.map((id, i) => [id, i]));
  const inCat = items.filter((i) => i.categoryId === action.categoryId).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  let k = 0;
  return items.map((i) => (i.categoryId === action.categoryId ? inCat[k++] : i));
}

function priceLabel(item: BoardItem) {
  if (item.price === null) return "No price";
  return item.hasSizes ? `from ${formatPKR(item.price)}` : formatPKR(item.price);
}

function itemMeta(item: BoardItem) {
  const parts = [];
  if (item.hasSizes) parts.push("sizes");
  if (item.extrasCount) parts.push(`${item.extrasCount} extra${item.extrasCount === 1 ? "s group" : "s groups"}`);
  if (item.removableCount) parts.push(`${item.removableCount} can be removed`);
  return parts.join(" · ");
}

export function MenuBoard({
  categories: serverCategories,
  items: serverItems,
  branchName,
  canEdit,
  canStock,
  canPrices,
}: {
  categories: BoardCategory[];
  items: BoardItem[];
  branchName: string | null;
  canEdit: boolean;
  canStock: boolean;
  canPrices: boolean;
}) {
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [items, applyItems] = useOptimistic(serverItems, itemsReducer);
  const [categories, applyCategoryOrder] = useOptimistic(serverCategories, (cats: BoardCategory[], ids: string[]) =>
    ids.map((id) => cats.find((c) => c.id === id)!).filter(Boolean),
  );
  const [selectedId, setSelectedId] = useState<string | null>(serverCategories[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<CategoryDraft | null>(null);

  const selected = categories.find((c) => c.id === selectedId) ?? categories[0] ?? null;
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of items) map.set(i.categoryId, (map.get(i.categoryId) ?? 0) + 1);
    return map;
  }, [items]);

  const q = query.trim().toLowerCase();
  const visibleItems = q
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q) ||
          i.aliases.some((a) => a.toLowerCase().includes(q)),
      )
    : items.filter((i) => i.categoryId === selected?.id);

  function toggleStock(item: BoardItem, inStock: boolean) {
    startTransition(async () => {
      applyItems({ type: "stock", id: item.id, inStock });
      const result = await setItemStock(item.id, inStock);
      if (!result.ok) toast({ title: result.error, tone: "error" });
      else if (!inStock) toast({ title: `${item.name} is out of stock`, description: "Hidden from WhatsApp until you turn it back on.", tone: "info" });
    });
  }

  function onReorderItems(next: BoardItem[]) {
    if (!selected) return;
    const ids = next.map((i) => i.id);
    startTransition(async () => {
      applyItems({ type: "order", categoryId: selected.id, ids });
      const result = await reorderItems(selected.id, ids);
      if (!result.ok) toast({ title: result.error, tone: "error" });
    });
  }

  function onReorderCategories(next: BoardCategory[]) {
    const ids = next.map((c) => c.id);
    startTransition(async () => {
      applyCategoryOrder(ids);
      const result = await reorderCategories(ids);
      if (!result.ok) toast({ title: result.error, tone: "error" });
    });
  }

  const newCategory = () => setDialog({ name: "", nameUr: "", isActive: true, itemCount: 0 });
  const editCategory = (c: BoardCategory) =>
    setDialog({ id: c.id, name: c.name, nameUr: c.nameUr ?? "", isActive: c.isActive, itemCount: counts.get(c.id) ?? 0 });
  const addItemHref = selected ? `/menu/items/new?category=${selected.id}` : "/menu/items/new";

  const header = (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Menu</h1>
        <p className="mt-1 text-muted">
          {items.length} item{items.length === 1 ? "" : "s"}
          {branchName ? ` · ${branchName}` : ""} · Changes show on WhatsApp right away
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/menu/extras" className={buttonVariants({ variant: "secondary" })}>
          <Layers aria-hidden />
          Extras
        </Link>
        {canPrices ? (
          <Link href="/menu/prices" className={buttonVariants({ variant: "secondary" })}>
            <ChartNoAxesColumnIncreasing aria-hidden />
            Change prices
          </Link>
        ) : null}
        {canEdit && categories.length ? (
          <Link href={addItemHref} className={buttonVariants()}>
            <Plus aria-hidden />
            Add item
          </Link>
        ) : null}
      </div>
    </div>
  );

  if (categories.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<BookOpen />}
          title="No items yet. Add your first item"
          description="Start with a category like Pizza, Burgers or Drinks, then add items to it."
          actions={
            canEdit ? (
              <div className="flex flex-col items-center gap-3">
                <Button icon={<Plus />} size="lg" onClick={newCategory}>
                  Add first category
                </Button>
                <span className="text-sm text-muted">or</span>
                <Button variant="secondary" icon={<Camera />} disabled>
                  Upload a photo of your menu — we’ll create it for you
                  <Badge tone="brand">Coming soon</Badge>
                </Button>
              </div>
            ) : null
          }
        />
        {dialog ? (
        <CategoryDialog key={dialog.id ?? "new"} category={dialog} onClose={() => setDialog(null)} onSaved={setSelectedId} />
      ) : null}
      </>
    );
  }

  return (
    <>
      {header}

      {!branchName && canStock ? (
        <Alert tone="info" className="mb-4">
          You’re viewing all branches. Choose a branch at the top to turn items in or out of stock.
        </Alert>
      ) : null}

      {/* Mobile: categories as tabs */}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setSelectedId(c.id);
              setQuery("");
            }}
            aria-pressed={c.id === selected?.id && !q}
            className={cn(
              "flex min-h-touch shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold",
              c.id === selected?.id && !q ? "border-ink bg-ink text-white" : "border-line-strong bg-surface",
              !c.isActive && "opacity-60",
            )}
          >
            {c.name} <span className="opacity-80">{counts.get(c.id) ?? 0}</span>
          </button>
        ))}
        {canEdit ? (
          <button
            type="button"
            onClick={newCategory}
            aria-label="Add category"
            className="flex min-h-touch shrink-0 items-center rounded-full border border-dashed border-brand-700 px-4 text-sm font-semibold text-brand-700"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Desktop: categories panel */}
        <Card padding="sm" className="hidden self-start lg:block">
          <p className="px-2 pt-2 pb-3 text-xs font-bold tracking-wide text-muted uppercase">Categories</p>
          <SortableList id="menu-categories" items={categories} onReorder={onReorderCategories} disabled={!canEdit} className="flex flex-col gap-1">
            {(c, { handle }) => {
              const active = c.id === selected?.id && !q;
              return (
                <div className={cn("flex items-center rounded-control", active ? "bg-brand-50 text-brand-800" : "hover:bg-subtle")}>
                  {canEdit ? <DragHandle handle={handle} label={`Move ${c.name}`} /> : <span className="w-3" />}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(c.id);
                      setQuery("");
                    }}
                    className={cn("flex min-h-touch flex-1 items-center justify-between gap-2 text-left text-base", active ? "font-bold" : "font-medium")}
                  >
                    <span className={cn("truncate", !c.isActive && "text-muted line-through")}>{c.name}</span>
                    <span className="text-sm">{counts.get(c.id) ?? 0}</span>
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => editCategory(c)}
                      aria-label={`Edit ${c.name}`}
                      className="flex size-touch shrink-0 items-center justify-center rounded-control text-muted hover:text-ink"
                    >
                      <MoreHorizontal aria-hidden className="size-5" />
                    </button>
                  ) : null}
                </div>
              );
            }}
          </SortableList>
          {canEdit ? (
            <button
              type="button"
              onClick={newCategory}
              className="mt-2 flex min-h-touch w-full items-center justify-center gap-2 rounded-control border-2 border-dashed border-line font-semibold text-brand-700 hover:border-brand-200"
            >
              <Plus aria-hidden className="size-4" />
              Add category
            </button>
          ) : null}
        </Card>

        {/* Items */}
        <section className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              {q ? (
                <>Search results · {visibleItems.length}</>
              ) : (
                <>
                  {selected?.name} <span className="font-normal text-muted">· {visibleItems.length} items</span>
                  {selected && !selected.isActive ? <Badge tone="delivered">Hidden</Badge> : null}
                  {canEdit && selected ? (
                    <Button variant="ghost" size="icon" aria-label={`Edit ${selected.name}`} onClick={() => editCategory(selected)} className="lg:hidden">
                      <Pencil />
                    </Button>
                  ) : null}
                </>
              )}
            </h2>
            <Input
              type="search"
              aria-label="Search items"
              placeholder="Search items"
              leadingIcon={<Search />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              wrapperClassName="sm:w-72"
            />
          </div>

          {visibleItems.length === 0 ? (
            <EmptyState
              icon={<BookOpen />}
              title={q ? "No items match your search" : `No items in ${selected?.name} yet`}
              actions={
                !q && canEdit ? (
                  <Link href={addItemHref} className={buttonVariants({ size: "lg" })}>
                    <Plus aria-hidden />
                    Add item
                  </Link>
                ) : null
              }
            />
          ) : (
            <SortableList
              id="menu-items"
              items={visibleItems}
              onReorder={onReorderItems}
              disabled={!canEdit || !!q}
              className="flex flex-col gap-3"
            >
              {(item, { handle }) => {
                const outOfStock = item.inStock === false;
                const dimmed = outOfStock || !item.isActive || item.hiddenHere;
                return (
                  <Card padding="sm" className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {canEdit && !q ? <DragHandle handle={handle} label={`Move ${item.name}`} className="hidden lg:flex" /> : null}
                      <ItemPhoto url={item.imageUrl} size={72} muted={dimmed} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className={cn("text-base font-bold lg:text-lg", dimmed && "text-muted")}>{item.name}</h3>
                          {!item.isActive ? <Badge tone="delivered">Hidden from menu</Badge> : null}
                          {item.hiddenHere ? <Badge tone="delivered">Not sold here</Badge> : null}
                        </div>
                        {item.description ? <p className="hidden line-clamp-2 text-sm text-muted sm:block">{item.description}</p> : null}
                        {itemMeta(item) ? <p className="hidden text-sm text-muted sm:block">{itemMeta(item)}</p> : null}
                        {outOfStock ? <p className="text-sm font-semibold text-danger">Hidden from WhatsApp until back in stock</p> : null}
                        <p className="mt-0.5 text-base font-bold lg:hidden">{priceLabel(item)}</p>
                      </div>
                      {canEdit ? (
                        <Link
                          href={`/menu/items/${item.id}`}
                          aria-label={`Edit ${item.name}`}
                          className={buttonVariants({ variant: "secondary", size: "icon", className: "lg:hidden" })}
                        >
                          <Pencil aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="hidden w-32 text-right text-lg font-bold whitespace-nowrap lg:block">{priceLabel(item)}</p>
                      {canStock && item.inStock !== null ? (
                        <div className="flex-1 lg:flex-none">
                          <div className="lg:hidden">
                            <StockToggle block itemName={item.name} inStock={item.inStock} onChange={(v) => toggleStock(item, v)} />
                          </div>
                          <div className="hidden lg:block">
                            <StockToggle itemName={item.name} inStock={item.inStock} onChange={(v) => toggleStock(item, v)} />
                          </div>
                        </div>
                      ) : null}
                      {canEdit ? (
                        <Link href={`/menu/items/${item.id}`} className={buttonVariants({ variant: "secondary", className: "hidden lg:inline-flex" })}>
                          <Pencil aria-hidden />
                          Edit
                        </Link>
                      ) : null}
                    </div>
                  </Card>
                );
              }}
            </SortableList>
          )}

          {canEdit && !q && selected && visibleItems.length > 0 ? (
            <Link
              href={addItemHref}
              className="mt-3 flex min-h-touch-lg w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-line font-semibold text-brand-700 hover:border-brand-200"
            >
              <Plus aria-hidden className="size-5" />
              Add item to {selected.name}
            </Link>
          ) : null}
        </section>
      </div>

      {dialog ? (
        <CategoryDialog key={dialog.id ?? "new"} category={dialog} onClose={() => setDialog(null)} onSaved={setSelectedId} />
      ) : null}
    </>
  );
}
