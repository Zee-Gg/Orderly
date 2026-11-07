"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, LoaderCircle, Minus, Pencil, Phone, Plus, Search, ShoppingBag, Store, TriangleAlert, Trash2, UserRound } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { BranchMenu, BranchMenuItem } from "@/lib/menu/pricing";
import {
  createOrderAction,
  editOrderAction,
  loadComposerMenuAction,
  lookupCustomerAction,
  previewOrderAction,
} from "@/lib/orders/actions";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type OrderType, type PaymentMethod } from "@/lib/orders/constants";
import type { PreviewResult } from "@/lib/orders/engine";
import { formatPhone } from "@/lib/orders/phone";
import type { CustomerLookup } from "@/lib/orders/queries";
import { formatPKR, paisaToInput, parseRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ItemPicker, defaultSelection, needsPicker, type ComposerLine } from "./item-picker";

export type ComposerEditOrder = {
  id: string;
  version: number;
  orderNumber: number;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  addressText: string;
  area: string;
  landmark: string;
  tableNumber: string;
  notes: string;
  deliveryFee: number;
  discount: number;
  lines: Omit<ComposerLine, "key">[];
};

const newKey = () => crypto.randomUUID();

/** Cart line without its local React key, as the server expects it. */
function toInputLine(line: ComposerLine): Omit<ComposerLine, "key"> {
  return { itemId: line.itemId, variantId: line.variantId, optionIds: line.optionIds, removals: line.removals, quantity: line.quantity, notes: line.notes };
}

export function OrderComposer({
  branches,
  initialBranchId,
  initialMenu,
  canDiscount,
  canOverrideBlock,
  editOrder,
}: {
  branches: { id: string; name: string }[];
  initialBranchId: string;
  initialMenu: BranchMenu;
  canDiscount: boolean;
  canOverrideBlock: boolean;
  editOrder?: ComposerEditOrder;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const editing = !!editOrder;

  // Menu ------------------------------------------------------------------
  const [branchId, setBranchId] = useState(initialBranchId);
  const [menu, setMenu] = useState(initialMenu);
  const [menuLoading, startMenuLoad] = useTransition();
  const [category, setCategory] = useState<string>(initialMenu.categories[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => menu.categories.flatMap((c) => c.items), [menu]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Cart ------------------------------------------------------------------
  const [lines, setLines] = useState<ComposerLine[]>(() => (editOrder?.lines ?? []).map((l) => ({ ...l, key: newKey() })));
  const [picker, setPicker] = useState<{ item: BranchMenuItem; line: ComposerLine | null } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  // Customer & order details ---------------------------------------------
  const [source, setSource] = useState<"phone" | "walk_in">("phone");
  const [phone, setPhone] = useState(editOrder?.customerPhone ? formatPhone(editOrder.customerPhone) : "");
  const [name, setName] = useState(editOrder?.customerName ?? "");
  const [found, setFound] = useState<CustomerLookup | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [orderType, setOrderType] = useState<OrderType>(editOrder?.orderType ?? "pickup");
  const [addressText, setAddressText] = useState(editOrder?.addressText ?? "");
  const [area, setArea] = useState(editOrder?.area ?? "");
  const [landmark, setLandmark] = useState(editOrder?.landmark ?? "");
  const [deliveryFee, setDeliveryFee] = useState(paisaToInput(editOrder?.deliveryFee ?? 0));
  const [tableNumber, setTableNumber] = useState(editOrder?.tableNumber ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(editOrder?.paymentMethod ?? "cod");
  const [notes, setNotes] = useState(editOrder?.notes ?? "");
  const [discount, setDiscount] = useState(paisaToInput(editOrder?.discount ?? 0));

  // Submit ----------------------------------------------------------------
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const feePaisa = orderType === "delivery" ? (parseRupees(deliveryFee || "0") ?? -1) : 0;
  const discountPaisa = parseRupees(discount || "0") ?? -1;

  // Server-side totals preview (debounced). Never computed in the browser.
  const previewKey = JSON.stringify([branchId, lines, feePaisa, discountPaisa]);
  useEffect(() => {
    if (lines.length === 0) return;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      const result = await previewOrderAction({
        branchId,
        lines: lines.map(toInputLine),
        deliveryFee: Math.max(0, feePaisa),
        discount: Math.max(0, discountPaisa),
      });
      setPreviewing(false);
      if (result.ok) setPreview(result.data);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewKey captures every input
  }, [previewKey]);

  // "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function changeBranch(id: string) {
    if (id === branchId) return;
    if (lines.length && !window.confirm("Changing the branch clears the cart (prices can differ). Continue?")) return;
    startMenuLoad(async () => {
      const result = await loadComposerMenuAction(id);
      if (!result.ok) {
        toast({ title: result.message, tone: "error" });
        return;
      }
      setBranchId(id);
      setMenu(result.data);
      setCategory(result.data.categories[0]?.id ?? "");
      setLines([]);
      setPreview(null);
    });
  }

  function addItem(item: BranchMenuItem) {
    if (!item.isAvailable) return;
    if (needsPicker(item)) {
      setPicker({ item, line: null });
      return;
    }
    const sel = defaultSelection(item);
    setLines((current) => {
      const same = current.find(
        (l) => l.itemId === item.id && l.variantId === sel.variantId && !l.optionIds.length && !l.removals.length && !l.notes,
      );
      if (same) return current.map((l) => (l === same ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l));
      return [...current, { key: newKey(), itemId: item.id, variantId: sel.variantId, optionIds: sel.optionIds, removals: [], quantity: 1, notes: "" }];
    });
    toast({ title: `${item.name} added`, duration: 1500 });
  }

  function onPhoneChange(value: string) {
    setPhone(value);
    setFound(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const digits = value.replace(/\D/g, "");
    if (digits.length < 10) return;
    lookupTimer.current = setTimeout(async () => {
      setLookingUp(true);
      const result = await lookupCustomerAction(value);
      setLookingUp(false);
      if (!result.ok || !result.data) return;
      setFound(result.data);
      if (result.data.name) setName((n) => n || result.data!.name!);
      const addr = result.data.addresses[0];
      if (addr) {
        setAddressText((a) => a || addr.addressText);
        setArea((a) => a || (addr.area ?? ""));
        setLandmark((a) => a || (addr.landmark ?? ""));
      }
    }, 350);
  }

  const lineResult = (index: number) => preview?.lines[index];
  const totals = preview?.totals?.ok ? preview.totals.totals : null;
  const totalsError = preview?.totals && !preview.totals.ok ? preview.totals.error.message : null;
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  const blocked = found?.isBlocked && !editing;

  function submit() {
    setFormError(null);
    setErrors({});
    if (feePaisa < 0) return setErrors({ deliveryFee: "Enter an amount like 150" });
    if (discountPaisa < 0) return setErrors({ discount: "Enter an amount like 100" });
    const address = orderType === "delivery" ? { addressText, area, landmark, save: true } : undefined;
    const common = {
      orderType,
      paymentMethod,
      address,
      tableNumber,
      notes,
      deliveryFee: feePaisa,
      discount: discountPaisa,
      lines: lines.map(toInputLine),
    };
    startSubmit(async () => {
      const result = editOrder
        ? await editOrderAction({ orderId: editOrder.id, expectedVersion: editOrder.version, ...common })
        : await createOrderAction({
            branchId,
            idempotencyKey,
            source,
            customer: { phone: source === "walk_in" && !phone.trim() ? "" : phone, name },
            overrideBlockReason: overrideReason,
            ...common,
          });
      if (!result.ok) {
        setFormError(result.message);
        setErrors(result.fieldErrors ?? {});
        if (result.lineErrors?.length) setCartOpen(true);
        return;
      }
      if (editOrder) {
        const kitchen = (result.data as { kitchenAlert?: boolean }).kitchenAlert;
        toast({ title: `Order #${editOrder.orderNumber} updated`, description: kitchen ? "The kitchen will be alerted." : undefined });
        router.push(`/orders?order=${editOrder.id}`);
      } else {
        const created = result.data as { id: string; orderNumber: number; duplicate: boolean };
        toast({ title: created.duplicate ? `Order #${created.orderNumber} was already placed` : `Order #${created.orderNumber} placed` });
        setIdempotencyKey(newKey());
        router.push(`/orders?order=${created.id}`);
      }
      router.refresh();
    });
  }

  const visible = search.trim()
    ? items.filter((i) => {
        const q = search.trim().toLowerCase();
        return i.name.toLowerCase().includes(q) || i.aliases.some((a) => a.toLowerCase().includes(q)) || i.nameUr?.includes(q);
      })
    : (menu.categories.find((c) => c.id === category)?.items ?? []);

  const cartPanel = (
    <div className="flex flex-col gap-4">
      {/* Customer */}
      <Card padding="md" className="flex flex-col gap-3">
        <h2 className="font-bold">Customer</h2>
        {editing ? (
          <p>
            {editOrder.customerName || "Walk-in customer"}
            {editOrder.customerPhone ? <span className="text-muted"> · {formatPhone(editOrder.customerPhone)}</span> : null}
          </p>
        ) : (
          <>
            <Tabs
              variant="segmented"
              aria-label="Order source"
              value={source}
              onValueChange={setSource}
              items={[
                { value: "phone", label: "Phone order", icon: <Phone aria-hidden /> },
                { value: "walk_in", label: "Walk-in", icon: <Store aria-hidden /> },
              ]}
            />
            <Input
              label={source === "walk_in" ? "Phone (optional)" : "Phone"}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              placeholder="0300-1234567"
              autoComplete="off"
              trailing={lookingUp ? <LoaderCircle aria-hidden className="mr-4 size-5 animate-spin text-muted" /> : undefined}
              error={errors["customer.phone"]}
            />
            {found ? (
              <div className="flex flex-col gap-2 rounded-card bg-subtle p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <UserRound aria-hidden className="size-4" />
                  {found.name ?? "Returning customer"} · {found.totalOrders} past order{found.totalOrders === 1 ? "" : "s"}
                </p>
                {found.tags.length ? (
                  <div className="flex flex-wrap gap-1">
                    {found.tags.map((t) => (
                      <Badge key={t} tone="brand">
                        {t}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {found.riskCount > 0 ? (
                  <Badge tone="danger-outline" shape="square" icon={<TriangleAlert />}>
                    {found.refusedCount} refused · {found.cancelledCount} fake before
                  </Badge>
                ) : null}
                {found.addresses.length > 1 && orderType === "delivery" ? (
                  <Select
                    aria-label="Saved addresses"
                    placeholder="Use a saved address"
                    value=""
                    onChange={(e) => {
                      const a = found.addresses.find((x) => x.id === e.target.value);
                      if (a) {
                        setAddressText(a.addressText);
                        setArea(a.area ?? "");
                        setLandmark(a.landmark ?? "");
                      }
                    }}
                    options={found.addresses.map((a) => ({ value: a.id, label: `${a.label ? `${a.label}: ` : ""}${a.addressText}` }))}
                  />
                ) : null}
              </div>
            ) : null}
            {blocked ? (
              <Alert title="This customer is blocked">
                {found?.blockedReason}
                {canOverrideBlock ? (
                  <Input
                    label="Reason to take this order anyway"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    wrapperClassName="mt-2"
                  />
                ) : (
                  <p className="mt-1">Ask a manager to take this order.</p>
                )}
              </Alert>
            ) : null}
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" error={errors["customer.name"]} />
          </>
        )}
      </Card>

      {/* Order type */}
      <Card padding="md" className="flex flex-col gap-3">
        <Tabs
          variant="segmented"
          aria-label="Order type"
          value={orderType}
          onValueChange={setOrderType}
          items={[
            { value: "delivery", label: "Delivery" },
            { value: "pickup", label: "Pickup" },
            { value: "dine_in", label: "Dine-in" },
          ]}
        />
        {orderType === "delivery" ? (
          <>
            <Textarea label="Address" value={addressText} onChange={(e) => setAddressText(e.target.value)} rows={2} error={errors["address.addressText"]} />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Gulberg III" />
              <Input label="Landmark" value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Near mosque" />
            </div>
            <MoneyInput label="Delivery fee" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} wrapperClassName="max-w-44" error={errors.deliveryFee} />
          </>
        ) : null}
        {orderType === "dine_in" ? (
          <Input label="Table number" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} wrapperClassName="max-w-44" error={errors.tableNumber} />
        ) : null}
      </Card>

      {/* Cart */}
      <Card padding="none">
        <h2 className="flex items-center justify-between border-b border-line px-4 py-3 font-bold">
          Order · {itemCount} item{itemCount === 1 ? "" : "s"}
          {previewing ? <LoaderCircle aria-label="Updating prices" className="size-4 animate-spin text-muted" /> : null}
        </h2>
        {lines.length === 0 ? (
          <p className="p-4 text-sm text-muted">Tap items on the menu to add them.</p>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((l, index) => {
              const item = itemById.get(l.itemId);
              const r = lineResult(index);
              const priced = r?.ok ? r.line : null;
              return (
                <li key={l.key} className="flex flex-col gap-1 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {priced?.itemName ?? item?.name ?? "Item"}
                        {priced?.sizeName ? <span className="font-normal text-muted"> · {priced.sizeName}</span> : null}
                      </p>
                      {priced?.options.length ? <p className="text-sm text-muted">+ {priced.options.map((o) => o.name).join(", ")}</p> : null}
                      {l.removals.length ? <p className="text-sm text-danger">No {l.removals.join(", no ")}</p> : null}
                      {l.notes ? <p className="text-sm italic">“{l.notes}”</p> : null}
                    </div>
                    <span className="shrink-0 font-semibold">{priced ? formatPKR(priced.lineTotal) : "—"}</span>
                  </div>
                  {r && !r.ok ? (
                    <p className="text-sm font-semibold text-danger">{r.errors.map((e) => e.message).join(" ")}</p>
                  ) : null}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label="Less"
                      onClick={() => setLines((c) => c.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))}
                      disabled={l.quantity <= 1}
                    >
                      <Minus />
                    </Button>
                    <span className="w-8 text-center font-bold">{l.quantity}</span>
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label="More"
                      onClick={() => setLines((c) => c.map((x) => (x.key === l.key ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x)))}
                    >
                      <Plus />
                    </Button>
                    {item && needsPicker(item) ? (
                      <Button variant="ghost" size="icon" aria-label="Change" onClick={() => setPicker({ item, line: l })}>
                        <Pencil />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove"
                      className="ml-auto text-danger"
                      onClick={() => setLines((c) => c.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {lines.length ? (
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 border-t border-line px-4 py-3 text-sm">
            <dt className="text-muted">Items</dt>
            <dd>{totals ? formatPKR(totals.subtotal) : "—"}</dd>
            {orderType === "delivery" ? (
              <>
                <dt className="text-muted">Delivery</dt>
                <dd>{totals ? formatPKR(totals.deliveryFee) : "—"}</dd>
              </>
            ) : null}
            {totals?.discount ? (
              <>
                <dt className="text-muted">Discount</dt>
                <dd>−{formatPKR(totals.discount)}</dd>
              </>
            ) : null}
            <dt className="text-lg font-bold">Total</dt>
            <dd className="text-lg font-bold">{totals ? formatPKR(totals.total) : previewing ? "…" : "—"}</dd>
            {totalsError ? <dd className="col-span-2 text-danger">{totalsError}</dd> : null}
          </dl>
        ) : null}
      </Card>

      {/* Payment and notes */}
      <Card padding="md" className="flex flex-col gap-3">
        <Select
          label="Payment"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
        />
        {canDiscount ? (
          <MoneyInput label="Discount (optional)" value={discount} onChange={(e) => setDiscount(e.target.value)} wrapperClassName="max-w-44" error={errors.discount} />
        ) : null}
        <Textarea label="Order note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder="e.g. Call at the gate" />
      </Card>

      {formError ? <Alert>{formError}</Alert> : null}
      <Button
        size="lg"
        fullWidth
        icon={<Check />}
        loading={submitting}
        disabled={lines.length === 0 || (blocked && !overrideReason.trim())}
        onClick={submit}
      >
        {editing ? "Save changes" : `Place order${totals ? ` · ${formatPKR(totals.total)}` : ""}`}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={editing ? `/orders?order=${editOrder.id}` : "/orders"} aria-label="Back to orders" className={buttonVariants({ variant: "secondary", size: "icon" })}>
          <ArrowLeft aria-hidden />
        </Link>
        <h1 className="flex-1 text-2xl font-bold lg:text-3xl">{editing ? `Edit order #${editOrder.orderNumber}` : "New order"}</h1>
        {!editing && branches.length > 1 ? (
          <Select
            aria-label="Branch"
            value={branchId}
            onChange={(e) => changeBranch(e.target.value)}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            wrapperClassName="w-48"
            disabled={menuLoading}
          />
        ) : null}
      </div>
      {editing && editOrder.status === "preparing" ? (
        <Alert tone="info">This order is already being prepared. The kitchen will be alerted about your changes.</Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Menu */}
        <section className={cn("flex min-w-0 flex-col gap-3", menuLoading && "opacity-60")}>
          <Input
            ref={searchRef}
            type="search"
            aria-label="Search menu"
            placeholder="Search menu  (press / )"
            leadingIcon={<Search />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && visible[0]) {
                e.preventDefault();
                addItem(visible[0]);
              }
            }}
          />
          {!search.trim() ? (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
              {menu.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    "min-h-touch shrink-0 rounded-full border px-4 text-sm font-semibold",
                    category === c.id ? "border-ink bg-ink text-white" : "border-line-strong bg-surface",
                  )}
                >
                  {c.name} <span className="opacity-70">{c.items.length}</span>
                </button>
              ))}
            </div>
          ) : null}
          {menu.categories.length === 0 ? <Alert tone="info">This branch has no menu items yet. Add items on the Menu page.</Alert> : null}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!item.isAvailable}
                  onClick={() => addItem(item)}
                  className="flex h-full min-h-24 w-full flex-col justify-between gap-2 rounded-card border border-line bg-surface p-3 text-left shadow-card hover:border-brand-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line"
                >
                  <span className="font-semibold">{item.name}</span>
                  <span className="text-sm">
                    {!item.isAvailable ? (
                      <span className="font-semibold text-danger">Out of stock</span>
                    ) : item.fromPrice !== null ? (
                      <span className="font-bold">
                        {item.sizes.length > 1 ? "from " : ""}
                        {formatPKR(item.fromPrice)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {search.trim() && visible.length === 0 ? <p className="text-muted">Nothing matches “{search}”.</p> : null}
        </section>

        {/* Cart (desktop) */}
        <aside className="hidden lg:block">{cartPanel}</aside>
      </div>

      {/* Cart (mobile) */}
      <div className="fixed inset-x-0 bottom-[calc(var(--spacing-touch-lg)+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface p-3 lg:hidden">
        <Button fullWidth size="lg" icon={<ShoppingBag />} onClick={() => setCartOpen(true)}>
          {lines.length ? `Review order · ${itemCount} item${itemCount === 1 ? "" : "s"}${totals ? ` · ${formatPKR(totals.total)}` : ""}` : "Review order"}
        </Button>
      </div>
      <Drawer open={cartOpen} onClose={() => setCartOpen(false)} title={editing ? "Edit order" : "Review order"}>
        {cartPanel}
      </Drawer>

      {picker ? (
        <ItemPicker
          key={picker.line?.key ?? picker.item.id}
          item={picker.item}
          branchId={branchId}
          line={picker.line}
          onClose={() => setPicker(null)}
          onSave={(draft) => {
            setLines((current) =>
              picker.line ? current.map((l) => (l.key === picker.line!.key ? { ...draft, key: l.key } : l)) : [...current, { ...draft, key: newKey() }],
            );
            setPicker(null);
            toast({ title: `${picker.item.name} ${picker.line ? "updated" : "added"}`, duration: 1500 });
          }}
        />
      ) : null}
    </div>
  );
}
