"use client";

import { useState, useTransition } from "react";
import { Ban, Banknote, PauseCircle, TriangleAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { holdOrderAction, recordPaymentAction, setCustomerBlockedAction, transitionOrderAction } from "@/lib/orders/actions";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/orders/constants";
import { CANCEL_REASONS, FAIL_REASONS, reasonNeedsNote } from "@/lib/orders/status";
import { formatPKR } from "@/lib/money";

type OrderRef = { id: string; orderNumber: number; version: number; customerName?: string | null; total?: number };

function ReasonList({
  reasons,
  value,
  onChange,
}: {
  reasons: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">Reason</legend>
      {reasons.map((r) => (
        <label
          key={r.value}
          className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-line px-3 has-checked:border-brand-700 has-checked:bg-brand-50"
        >
          <input
            type="radio"
            name="reason"
            value={r.value}
            checked={value === r.value}
            onChange={() => onChange(r.value)}
            className="size-4 accent-brand-700"
          />
          <span className="text-sm font-medium">{r.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Reject / cancel (with reason) or "Delivery failed". */
export function CancelDialog({
  order,
  mode,
  onClose,
  onDone,
}: {
  order: OrderRef;
  mode: "reject" | "cancel" | "fail";
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const reasons = mode === "fail" ? FAIL_REASONS : CANCEL_REASONS;
  const [reason, setReason] = useState<string>(mode === "fail" ? "customer_refused" : "customer_cancelled");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const title =
    mode === "fail" ? `Delivery failed for #${order.orderNumber}?` : `${mode === "reject" ? "Reject" : "Cancel"} order #${order.orderNumber}?`;

  function submit() {
    setError(null);
    if (reasonNeedsNote(reason) && !note.trim()) {
      setError("Please write the reason.");
      return;
    }
    startTransition(async () => {
      const result = await transitionOrderAction({
        orderId: order.id,
        expectedVersion: order.version,
        path: [mode === "fail" ? "failed" : "cancelled"],
        reason,
        note,
      });
      if (!result.ok) {
        setError(result.message);
        if (result.code === "VERSION_CONFLICT") onDone();
        return;
      }
      toast({ title: mode === "fail" ? `Order #${order.orderNumber} marked as failed` : `Order #${order.orderNumber} cancelled`, tone: "info" });
      onDone();
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      tone="danger"
      icon={<TriangleAlert />}
      title={title}
      description={
        mode === "fail"
          ? "Choose what happened. Refusals are counted against the customer."
          : `${order.customerName ?? "The customer"} will be told the reason once WhatsApp is connected.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {mode === "fail" ? "Back" : "Keep order"}
          </Button>
          <Button variant="danger" loading={pending} onClick={submit}>
            {mode === "fail" ? "Mark failed" : mode === "reject" ? "Reject order" : "Cancel order"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <ReasonList reasons={reasons} value={reason} onChange={setReason} />
        <Textarea
          label={reasonNeedsNote(reason) ? "What happened?" : "Note (optional)"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={300}
        />
      </div>
    </Modal>
  );
}

export function HoldDialog({ order, onClose, onDone }: { order: OrderRef; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Modal
      open
      onClose={onClose}
      icon={<PauseCircle />}
      title={`Put #${order.orderNumber} on hold?`}
      description="It stays on the board but can't move forward until you release it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await holdOrderAction({ orderId: order.id, expectedVersion: order.version, hold: true, reason });
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                toast({ title: `Order #${order.orderNumber} is on hold`, tone: "info" });
                onDone();
                onClose();
              })
            }
          >
            Put on hold
          </Button>
        </>
      }
    >
      {error ? <Alert className="mb-3">{error}</Alert> : null}
      <Input
        label="Why?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Waiting for customer to confirm address"
        autoFocus
        maxLength={300}
      />
    </Modal>
  );
}

export function PaymentDialog({
  order,
  method: initialMethod,
  onClose,
  onDone,
}: {
  order: OrderRef & { total: number };
  method: PaymentMethod;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsRef = method === "bank_transfer" || method === "online_link";
  return (
    <Modal
      open
      onClose={onClose}
      icon={<Banknote />}
      title={`Mark #${order.orderNumber} as paid?`}
      description={`Only do this after you have the money: ${formatPKR(order.total)}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await recordPaymentAction({ orderId: order.id, method, reference });
                if (!result.ok) {
                  setError(result.fieldErrors?.reference ?? result.message);
                  return;
                }
                toast({ title: `Order #${order.orderNumber} marked as paid` });
                onDone();
                onClose();
              })
            }
          >
            {method === "cod" ? "Cash received" : "Payment verified"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <Select
          label="How did they pay?"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
        />
        {needsRef ? (
          <Input
            label="Transaction ID"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            hint="From the bank app or the customer's screenshot."
            maxLength={100}
          />
        ) : null}
      </div>
    </Modal>
  );
}

export function BlockCustomerDialog({
  customer,
  onClose,
  onDone,
}: {
  customer: { id: string; name: string | null; isBlocked: boolean };
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const blocking = !customer.isBlocked;
  return (
    <Modal
      open
      onClose={onClose}
      tone={blocking ? "danger" : "default"}
      icon={<Ban />}
      title={blocking ? `Block ${customer.name ?? "this customer"}?` : `Unblock ${customer.name ?? "this customer"}?`}
      description={blocking ? "New orders from this number will be stopped. A manager can still override." : "They can order again."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            variant={blocking ? "danger" : "primary"}
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setCustomerBlockedAction({ customerId: customer.id, blocked: blocking, reason });
                if (!result.ok) {
                  setError(result.fieldErrors?.reason ?? result.message);
                  return;
                }
                toast({ title: blocking ? "Customer blocked" : "Customer unblocked", tone: "info" });
                onDone();
                onClose();
              })
            }
          >
            {blocking ? "Block" : "Unblock"}
          </Button>
        </>
      }
    >
      {error ? <Alert className="mb-3">{error}</Alert> : null}
      {blocking ? (
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 3 fake orders" maxLength={300} autoFocus />
      ) : null}
    </Modal>
  );
}
