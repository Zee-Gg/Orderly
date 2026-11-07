"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, Check, MapPin, MessageCircle, Phone, TriangleAlert } from "lucide-react";
import { BlockCustomerDialog } from "@/components/orders/order-dialogs";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipInput } from "@/components/ui/chip-input";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { updateCustomerAction } from "@/lib/orders/actions";
import { ORDER_TYPE_LABELS, type OrderStatus, type OrderType } from "@/lib/orders/constants";
import { formatPhone } from "@/lib/orders/phone";
import { formatPKR } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const PRESET_TAGS = ["Regular", "VIP", "Problem"];

type Customer = {
  id: string;
  name: string | null;
  phone: string;
  notes: string;
  tags: string[];
  isBlocked: boolean;
  blockedReason: string | null;
  totalOrders: number;
  totalSpent: number;
  cancelledCount: number;
  refusedCount: number;
  lastOrderAt: string | null;
  createdAt: string;
  addresses: { id: string; label: string | null; addressText: string; area: string | null; landmark: string | null; isDefault: boolean }[];
};

export function CustomerProfile({
  customer,
  orders,
  timezone,
  canEdit,
  canBlock,
}: {
  customer: Customer;
  orders: { id: string; orderNumber: number; status: OrderStatus; orderType: OrderType; total: number; createdAt: string; branchName: string }[];
  timezone: string;
  canEdit: boolean;
  canBlock: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(customer.name ?? "");
  const [notes, setNotes] = useState(customer.notes);
  const [tags, setTags] = useState(customer.tags);
  const [error, setError] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const dirty = name !== (customer.name ?? "") || notes !== customer.notes || tags.join("|") !== customer.tags.join("|");

  function save() {
    setError(null);
    startSaving(async () => {
      const result = await updateCustomerAction({ customerId: customer.id, name, notes, tags });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast({ title: "Customer saved" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <Link href="/customers" aria-label="Back to customers" className={buttonVariants({ variant: "secondary", size: "icon" })}>
          <ArrowLeft aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold lg:text-3xl">{customer.name || "No name"}</h1>
          <p className="text-muted">{formatPhone(customer.phone)}</p>
        </div>
        <div className="flex gap-2">
          <a href={`tel:${customer.phone}`} className={buttonVariants({ variant: "secondary" })}>
            <Phone aria-hidden />
            Call
          </a>
          <a href={`https://wa.me/${customer.phone.replace("+", "")}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "secondary" })}>
            <MessageCircle aria-hidden className="text-whatsapp" />
            WhatsApp
          </a>
        </div>
      </div>

      {customer.isBlocked ? <Alert title="Blocked">{customer.blockedReason}</Alert> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Completed orders", String(customer.totalOrders)],
          ["Total spent", formatPKR(customer.totalSpent)],
          ["Fake orders", String(customer.cancelledCount)],
          ["Refused deliveries", String(customer.refusedCount)],
        ].map(([label, value]) => (
          <Card key={label} padding="sm">
            <p className="text-sm text-muted">{label}</p>
            <p className={cn("text-xl font-bold", (label === "Fake orders" || label === "Refused deliveries") && value !== "0" && "text-danger")}>
              {value}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card padding="lg" className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">Details</h2>
          {error ? <Alert>{error}</Alert> : null}
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
          <div>
            <p className="mb-2 text-sm font-semibold">Tags</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {PRESET_TAGS.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={on}
                    onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                    className={cn(
                      "flex min-h-touch items-center gap-1 rounded-full border px-4 text-sm font-semibold",
                      on ? "border-brand-700 bg-brand-50 text-brand-800" : "border-line-strong text-muted",
                    )}
                  >
                    {on ? <Check aria-hidden className="size-4" /> : null}
                    {t}
                  </button>
                );
              })}
            </div>
            {canEdit ? (
              <ChipInput label="Other tags" value={tags.filter((t) => !PRESET_TAGS.includes(t))} onChange={(v) => setTags([...tags.filter((t) => PRESET_TAGS.includes(t)), ...v])} maxItems={17} maxLength={30} />
            ) : null}
          </div>
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} disabled={!canEdit} placeholder="e.g. Prefers less spicy. Gate code 1234." />
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <Button loading={saving} disabled={!dirty} onClick={save}>
                Save
              </Button>
            ) : null}
            {canBlock ? (
              <Button variant={customer.isBlocked ? "secondary" : "danger-outline"} icon={<Ban />} onClick={() => setBlockOpen(true)}>
                {customer.isBlocked ? "Unblock" : "Block customer"}
              </Button>
            ) : null}
          </div>
          {customer.cancelledCount + customer.refusedCount > 0 ? (
            <Badge tone="danger-outline" shape="square" size="md" icon={<TriangleAlert />} className="self-start">
              Risky: {customer.refusedCount} refused · {customer.cancelledCount} fake
            </Badge>
          ) : null}
        </Card>

        <Card padding="lg" className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Addresses</h2>
          {customer.addresses.length === 0 ? <p className="text-sm text-muted">No saved addresses.</p> : null}
          <ul className="flex flex-col gap-2">
            {customer.addresses.map((a) => (
              <li key={a.id} className="flex gap-2 rounded-card border border-line p-3 text-sm">
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                <div>
                  <p className="font-semibold">
                    {a.label || "Address"} {a.isDefault ? <span className="font-normal text-muted">· default</span> : null}
                  </p>
                  <p>{a.addressText}</p>
                  <p className="text-muted">{[a.area, a.landmark && `Near ${a.landmark}`].filter(Boolean).join(" · ")}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card padding="none">
        <h2 className="border-b border-line px-4 py-3 text-lg font-bold">Order history</h2>
        {orders.length === 0 ? (
          <p className="p-4 text-sm text-muted">No orders yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders?order=${o.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-page">
                  <span className="font-bold">#{o.orderNumber}</span>
                  <span className="text-sm text-muted">
                    {formatDateTime(o.createdAt, timezone)} · {ORDER_TYPE_LABELS[o.orderType]}
                    {o.branchName ? ` · ${o.branchName}` : ""}
                  </span>
                  <StatusBadge status={o.status} />
                  <span className="ml-auto font-bold">{formatPKR(o.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {blockOpen ? (
        <BlockCustomerDialog
          customer={{ id: customer.id, name: customer.name, isBlocked: customer.isBlocked }}
          onClose={() => setBlockOpen(false)}
          onDone={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
