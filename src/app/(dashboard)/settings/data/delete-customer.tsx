"use client";

import { useState, useTransition } from "react";
import { Search, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { deleteCustomerAction, findCustomerForDeletionAction, type FoundCustomer } from "@/lib/privacy/actions";

/** Find a customer by phone, show what will happen, type DELETE to confirm. */
export function DeleteCustomer() {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<FoundCustomer | null>(null);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card padding="lg" className="flex flex-col gap-3" data-testid="delete-customer">
      <div>
        <h2 className="text-lg font-bold">Delete a customer&apos;s data</h2>
        <p className="text-sm text-muted">
          When a customer asks, remove their name, phone number, addresses, WhatsApp messages, voice notes and photos. Their past orders stay in your
          reports as “Deleted customer”. This can&apos;t be undone.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setFound(null);
          start(async () => {
            const r = await findCustomerForDeletionAction({ phone });
            if (r.ok && r.data) setFound(r.data);
            else if (!r.ok) setError(r.error);
          });
        }}
      >
        <Input label="Customer phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300 1234567" wrapperClassName="flex-1 min-w-56" />
        <Button type="submit" variant="secondary" icon={<Search />} loading={pending && !found}>
          Find
        </Button>
      </form>
      {error ? <Alert>{error}</Alert> : null}
      {found ? (
        <div className="flex flex-col gap-3 rounded-control border border-status-cancelled-border bg-status-cancelled-bg/40 p-3">
          <p>
            <strong>{found.name || "No name"}</strong> · {found.phone} · {found.totalOrders} order{found.totalOrders === 1 ? "" : "s"}
          </p>
          <Input label='Type DELETE to confirm' value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          <Button
            variant="danger"
            icon={<Trash2 />}
            disabled={confirm !== "DELETE"}
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteCustomerAction({ customerId: found.id, confirm: "DELETE" });
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                toast({ title: `Deleted. ${r.data?.ordersAnonymized ?? 0} order(s) now show “Deleted customer”.` });
                setFound(null);
                setPhone("");
                setConfirm("");
              })
            }
          >
            Delete this customer&apos;s data
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
