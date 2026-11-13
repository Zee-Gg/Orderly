"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { changePlanAction, extendTrialAction, recordPaymentAction, saveSubscriptionNotesAction, setRestaurantAccessAction } from "@/lib/admin/actions";
import { PAYMENT_METHODS, SUBSCRIPTION_PAYMENT_LABELS, type SubscriptionPaymentMethod, type SubscriptionStatus } from "@/lib/billing/core";
import { adminDeleteCustomerAction } from "@/lib/privacy/actions";

type Dialog = null | "suspend" | "payment" | "trial" | "delete";

/** Super admin buttons on /admin/restaurants/[id]. */
export function RestaurantActions({
  restaurantId,
  status,
  planId,
  plans,
  notes,
}: {
  restaurantId: string;
  status: SubscriptionStatus | null;
  planId: string | null;
  plans: { id: string; name: string; price: number }[];
  notes: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState(planId ?? "");
  const [days, setDays] = useState("7");
  const [note, setNote] = useState(notes ?? "");
  const currentPrice = plans.find((p) => p.id === planId)?.price ?? 0;
  const [pay, setPay] = useState({
    amount: currentPrice ? String(currentPrice / 100) : "",
    method: "bank_transfer" as SubscriptionPaymentMethod,
    reference: "",
    notes: "",
  });
  const [del, setDel] = useState({ phone: "", confirm: "" });

  function open(d: Dialog) {
    setError(null);
    setDialog(d);
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, done?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "Something went wrong");
        return;
      }
      toast({ title: r.message ?? "Done" });
      setDialog(null);
      done?.();
      router.refresh();
    });
  }

  const suspended = status === "suspended" || status === "cancelled";

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
      {error && !dialog ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => open("payment")}>Record payment</Button>
        <Button variant="secondary" onClick={() => open("trial")}>
          Extend trial
        </Button>
        {suspended ? (
          <Button variant="secondary" loading={pending} onClick={() => run(() => setRestaurantAccessAction({ restaurantId, action: "reactivate" }))}>
            Reactivate
          </Button>
        ) : (
          <Button variant="danger-outline" onClick={() => open("suspend")}>
            Suspend
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="Plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          options={plans.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="No plan"
          wrapperClassName="min-w-56 flex-1"
        />
        <Button variant="secondary" disabled={!plan || plan === planId} loading={pending} onClick={() => run(() => changePlanAction({ restaurantId, planId: plan }))}>
          Change plan
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <Textarea label="Private notes (only you see these)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <div>
          <Button variant="secondary" loading={pending} onClick={() => run(() => saveSubscriptionNotesAction({ restaurantId, notes: note }))}>
            Save notes
          </Button>
        </div>
      </div>
      <div>
        <Button variant="ghost" onClick={() => open("delete")}>
          Delete a customer&apos;s data…
        </Button>
      </div>

      <Modal
        open={dialog === "suspend"}
        onClose={() => setDialog(null)}
        tone="danger"
        title="Suspend this restaurant?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Keep active
            </Button>
            <Button variant="danger" loading={pending} onClick={() => run(() => setRestaurantAccessAction({ restaurantId, action: "suspend" }))}>
              Suspend
            </Button>
          </>
        }
      >
        {error ? <Alert>{error}</Alert> : null}
        <p>
          Staff will only see the suspension notice and billing. The bot replies once per chat with the phone number, and the menu page shows “not
          available”. Nothing is deleted.
        </p>
      </Modal>

      <Modal
        open={dialog === "trial"}
        onClose={() => setDialog(null)}
        title="Extend the free trial"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={() => run(() => extendTrialAction({ restaurantId, days: Number(days) || 0 }))}>
              Extend
            </Button>
          </>
        }
      >
        {error ? <Alert>{error}</Alert> : null}
        <Input label="Extra days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
      </Modal>

      <Modal
        open={dialog === "payment"}
        onClose={() => setDialog(null)}
        title="Record a payment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={() => run(() => recordPaymentAction({ restaurantId, ...pay }))}>
              Save payment
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {error ? <Alert>{error}</Alert> : null}
          <p className="text-sm text-muted">Adds one month to the paid period and makes the account active.</p>
          <Input label="Amount (Rs)" inputMode="decimal" value={pay.amount} onChange={(e) => setPay((x) => ({ ...x, amount: e.target.value }))} />
          <Select
            label="Paid by"
            value={pay.method}
            onChange={(e) => setPay((x) => ({ ...x, method: e.target.value as SubscriptionPaymentMethod }))}
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: SUBSCRIPTION_PAYMENT_LABELS[m] }))}
          />
          <Input label="Reference / transaction ID" value={pay.reference} onChange={(e) => setPay((x) => ({ ...x, reference: e.target.value }))} />
          <Input label="Note (optional)" value={pay.notes} onChange={(e) => setPay((x) => ({ ...x, notes: e.target.value }))} />
        </div>
      </Modal>

      <Modal
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        tone="danger"
        title="Delete a customer's data"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={del.confirm !== "DELETE" || !del.phone}
              loading={pending}
              onClick={() => run(() => adminDeleteCustomerAction({ restaurantId, ...del }), () => setDel({ phone: "", confirm: "" }))}
            >
              Delete
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {error ? <Alert>{error}</Alert> : null}
          <p className="text-sm">Removes name, phone, addresses, messages, voice notes and photos. Orders stay as “Deleted customer”. Can&apos;t be undone.</p>
          <Input label="Customer phone" inputMode="tel" value={del.phone} onChange={(e) => setDel((x) => ({ ...x, phone: e.target.value }))} />
          <Input label="Type DELETE" value={del.confirm} onChange={(e) => setDel((x) => ({ ...x, confirm: e.target.value }))} autoComplete="off" />
        </div>
      </Modal>
    </div>
  );
}
