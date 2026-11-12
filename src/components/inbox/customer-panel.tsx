"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Ban, Home, Pencil, Phone, Plus, ShoppingCart, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { usePermission } from "@/lib/auth/permissions-context";
import { addNoteAction, renameCustomerAction, setCustomerTagsAction } from "@/lib/inbox/actions";
import type { ConversationDetail } from "@/lib/inbox/queries";
import { initials } from "@/lib/inbox/rules";
import { formatPKR } from "@/lib/money";
import type { OrderStatus } from "@/lib/orders/constants";
import { setCustomerBlockedAction } from "@/lib/orders/actions";
import { formatPhone } from "@/lib/orders/phone";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const CUSTOMER_TAGS = ["Regular", "VIP", "Problem"];
const STAGE_TEXT: Record<string, string> = {
  collecting_items: "choosing items",
  choosing_order_type: "waiting for delivery or pickup",
  collecting_address: "waiting for address",
  choosing_payment: "waiting for payment choice",
  collecting_name: "waiting for name",
  awaiting_confirmation: "summary sent, waiting for Confirm",
};

/** Column 3 of the inbox: who this customer is, their orders, the bot's cart, internal notes. */
export function CustomerPanel({ detail, onChanged }: { detail: ConversationDetail; onChanged: () => Promise<void> | void }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const canEdit = usePermission("customers.edit");
  const canBlock = usePermission("customers.block");
  const canOrder = usePermission("orders.create");
  const c = detail.customer;
  const conv = detail.conversation;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c?.name ?? "");
  const [note, setNote] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast({ title: r.error ?? r.message ?? "Couldn't save", tone: "error" });
      else after?.();
      await onChanged();
    });
  }

  const phone = c?.phone ?? conv.phone ?? "";
  const orderLink = (extra: Record<string, string>) => `/orders/new?${new URLSearchParams({ phone, ...(c?.name ? { name: c.name } : {}), ...extra })}`;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="customer-panel">
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-800" aria-hidden>
          {initials(c?.name ?? conv.name, "#")}
        </span>
        {editing && c ? (
          <form
            className="flex w-full gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => renameCustomerAction({ customerId: c.id, name }), () => setEditing(false));
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-touch flex-1 rounded-control border border-line-strong px-2" aria-label="Customer name" autoFocus />
            <button type="submit" disabled={pending} className="min-h-touch rounded-control bg-brand-700 px-3 font-semibold text-white">
              Save
            </button>
          </form>
        ) : (
          <p className="flex items-center gap-1 text-xl font-bold">
            {c?.name || "No name yet"}
            {c && canEdit ? (
              <button type="button" onClick={() => setEditing(true)} aria-label="Edit name" className="flex size-touch items-center justify-center text-muted">
                <Pencil aria-hidden className="size-4" />
              </button>
            ) : null}
          </p>
        )}
        {phone ? (
          <a href={`tel:${phone}`} className="flex min-h-touch items-center gap-1 text-muted underline">
            <Phone aria-hidden className="size-4" /> {formatPhone(phone)}
          </a>
        ) : null}
        <div className="flex flex-wrap justify-center gap-1.5">
          {c && c.riskCount > 0 ? (
            <span className="flex items-center gap-1 rounded-full border border-status-cancelled-border bg-status-cancelled-bg px-2 py-0.5 text-xs font-bold text-status-cancelled-fg">
              <TriangleAlert aria-hidden className="size-3" /> Fake order risk · {c.riskCount}
            </span>
          ) : null}
          {c?.isBlocked ? <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">Blocked</span> : null}
          {CUSTOMER_TAGS.map((t) => {
            const on = c?.tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                disabled={!c || !canEdit || pending}
                aria-pressed={on}
                onClick={() => c && run(() => setCustomerTagsAction({ customerId: c.id, tags: on ? c.tags.filter((x) => x !== t) : [...c.tags, t] }))}
                className={cn("min-h-8 rounded-full border px-2.5 text-xs font-bold", on ? "border-status-accepted-border bg-status-accepted-bg text-status-accepted-fg" : "border-dashed border-line-strong text-muted")}
              >
                {on ? t : `+ ${t}`}
              </button>
            );
          })}
        </div>
      </div>

      {c ? (
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-control bg-subtle p-3">
            <dt className="text-xs text-muted">Total orders</dt>
            <dd className="text-xl font-bold">{c.totalOrders}</dd>
          </div>
          <div className="rounded-control bg-subtle p-3">
            <dt className="text-xs text-muted">Total spent</dt>
            <dd className="text-xl font-bold">{formatPKR(c.totalSpent)}</dd>
          </div>
        </dl>
      ) : null}

      {/* The bot's cart (finish the order after a handoff) */}
      {detail.botCart ? (
        <section className="rounded-card border-2 border-brand-200 bg-brand-50 p-3" data-testid="bot-cart">
          <h3 className="flex items-center gap-2 font-bold">
            <ShoppingCart aria-hidden className="size-4" /> Building an order
          </h3>
          <p className="text-sm text-muted">{STAGE_TEXT[detail.botCart.stage] ?? detail.botCart.stage}{detail.botCart.orderType ? ` · ${detail.botCart.orderType}` : ""}</p>
          <ul className="mt-2 text-sm">
            {detail.botCart.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {l.quantity}× {l.name}
                  {l.sizeName ? ` (${l.sizeName})` : ""}
                </span>
                <span>{formatPKR(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 flex justify-between border-t border-brand-200 pt-1 text-sm font-bold">
            <span>Subtotal</span>
            <span>{formatPKR(detail.botCart.subtotal)}</span>
          </p>
          {canOrder ? (
            <Link href={orderLink({ cart: detail.botCart.sessionId })} className={buttonVariants({ fullWidth: true, className: "mt-2" })} data-testid="order-from-cart">
              Create order from this cart
            </Link>
          ) : null}
        </section>
      ) : null}

      {canOrder && phone ? (
        <Link href={orderLink({})} className={buttonVariants({ variant: "secondary", fullWidth: true })}>
          <Plus aria-hidden /> New order for this customer
        </Link>
      ) : null}

      {c?.notes ? (
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">About this customer</h3>
          <p className="whitespace-pre-wrap rounded-control bg-subtle p-2 text-sm">{c.notes}</p>
        </section>
      ) : null}

      {c?.addresses.length ? (
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Saved addresses</h3>
          <ul className="flex flex-col gap-2">
            {c.addresses.map((a) => (
              <li key={a.id} className="flex gap-2 rounded-card border border-line p-2 text-sm">
                <Home aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-700" />
                <span>
                  {a.label ? <strong>{a.label} · </strong> : null}
                  {[a.addressText, a.area, a.landmark && `near ${a.landmark}`].filter(Boolean).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {c?.orders.length ? (
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Last orders</h3>
          <ul className="flex flex-col gap-2">
            {c.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders?order=${o.id}`} className="flex items-center gap-2 rounded-card border border-line p-2 text-sm hover:bg-subtle">
                  <span className="min-w-0 flex-1">
                    <span className="font-bold">#{o.orderNumber}</span> · {formatDateTime(o.createdAt)}
                    <span className="block text-muted">{o.itemCount} items</span>
                  </span>
                  <span className="font-semibold">{formatPKR(o.total)}</span>
                  <StatusBadge status={o.status as OrderStatus} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {c && canBlock ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const reason = c.isBlocked ? "" : (window.prompt("Why block this customer?") ?? "");
            if (!c.isBlocked && !reason.trim()) return;
            run(async () => {
              const r = await setCustomerBlockedAction({ customerId: c.id, blocked: !c.isBlocked, reason });
              return r.ok ? { ok: true } : { ok: false, error: r.message };
            });
          }}
          className="flex min-h-touch items-center justify-center gap-2 rounded-control border border-status-cancelled-border font-semibold text-danger"
        >
          <Ban aria-hidden className="size-4" /> {c.isBlocked ? "Unblock customer" : "Block customer"}
        </button>
      ) : null}

      {/* Internal notes (staff only, never sent) */}
      <section>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Notes for staff</h3>
        <ul className="flex flex-col gap-2">
          {detail.notes.map((n) => (
            <li key={n.id} className="rounded-control border border-status-awaiting-border bg-status-awaiting-bg p-2 text-sm" data-testid="note">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-status-awaiting-fg">
                {n.userName ?? "Staff"} · {formatDateTime(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            run(() => addNoteAction({ conversationId: conv.id, body: note }), () => setNote(""));
          }}
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Add a note (customer can't see it)"
            aria-label="Add a note"
            className="min-h-touch flex-1 rounded-control border border-status-awaiting-border bg-status-awaiting-bg/40 px-2 text-sm"
          />
          <button type="submit" disabled={pending || !note.trim()} className="min-h-touch rounded-control bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </form>
      </section>
    </div>
  );
}
