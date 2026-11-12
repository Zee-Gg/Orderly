"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Bike, KeyRound, Pencil, Plus, Shuffle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { paisaToInput, parseRupees, formatPKR } from "@/lib/money";
import { formatPhone } from "@/lib/orders/phone";
import { useLiveRefresh } from "@/lib/realtime/use-live-refresh";
import { addRiderAction, resetRiderPinAction, settleRiderCashAction, updateRiderAction } from "@/lib/riders/actions";
import { fetchRiderCashAction } from "@/lib/riders/home-action";
import type { RiderSummary, Settlement, UnsettledOrder } from "@/lib/riders/queries";
import { formatDateTime } from "@/lib/time";

type Branch = { id: string; name: string };

/** A random 6-digit PIN (shown once to the manager to give the rider). */
function randomPin() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, "0");
}

export function RidersManager({
  riders,
  branches,
  restaurantId,
  canManage,
}: {
  riders: RiderSummary[];
  branches: Branch[];
  restaurantId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    | { kind: "add" }
    | { kind: "edit"; rider: RiderSummary }
    | { kind: "pin"; rider: RiderSummary }
    | { kind: "settle"; rider: RiderSummary }
    | null
  >(null);
  // Live: online status + orders change → refresh.
  useLiveRefresh({ table: "rider_profiles", filter: `restaurant_id=eq.${restaurantId}`, refresh: () => router.refresh() });
  useLiveRefresh({ table: "orders", filter: `restaurant_id=eq.${restaurantId}`, refresh: () => router.refresh() });
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";
  const active = riders.filter((r) => r.isActive);
  const off = riders.filter((r) => !r.isActive);

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div>
          <Button icon={<Plus />} onClick={() => setDialog({ kind: "add" })}>
            Add rider
          </Button>
        </div>
      ) : null}

      {riders.length === 0 ? (
        <EmptyState
          tone="delivery"
          icon={<Bike />}
          title="No riders added"
          description="Add your riders with their phone number and a 6-digit PIN. They log in at /rider/login to see orders and cash to collect."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="riders-list">
          {[...active, ...off].map((r) => (
            <li key={r.id}>
              <Card className={`flex flex-col gap-3 ${r.isActive ? "" : "opacity-60"}`} data-testid="rider-row" data-rider={r.name}>
                <div className="flex items-start gap-3">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-status-delivery-bg text-status-delivery-fg">
                    <Bike aria-hidden className="size-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold">{r.name}</p>
                    <p className="text-sm text-muted">
                      {formatPhone(r.phone)} · {branchName(r.branchId)}
                    </p>
                  </div>
                  {!r.isActive ? (
                    <Badge tone="delivered">Switched off</Badge>
                  ) : r.isOnline ? (
                    <Badge tone="ready">● Online</Badge>
                  ) : (
                    <Badge tone="neutral">Offline</Badge>
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-control bg-subtle p-2">
                    <dt className="text-xs text-muted">Active</dt>
                    <dd className="text-xl font-bold">{r.activeDeliveries}</dd>
                  </div>
                  <div className="rounded-control bg-subtle p-2">
                    <dt className="text-xs text-muted">Today</dt>
                    <dd className="text-xl font-bold">{r.deliveriesToday}</dd>
                  </div>
                  <div className={`rounded-control p-2 ${r.cashInHand ? "bg-status-awaiting-bg" : "bg-subtle"}`}>
                    <dt className="text-xs text-muted">Cash in hand</dt>
                    <dd className="text-xl font-bold" data-testid="rider-cash">
                      {formatPKR(r.cashInHand)}
                    </dd>
                  </div>
                </dl>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" icon={<Banknote />} disabled={!r.cashInHand} onClick={() => setDialog({ kind: "settle", rider: r })}>
                      Settle cash
                    </Button>
                    <Button variant="secondary" icon={<Pencil />} onClick={() => setDialog({ kind: "edit", rider: r })}>
                      Edit
                    </Button>
                    <Button variant="secondary" icon={<KeyRound />} onClick={() => setDialog({ kind: "pin", rider: r })}>
                      Reset PIN
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "add" ? <AddRider branches={branches} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <EditRider rider={dialog.rider} branches={branches} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "pin" ? <ResetPin rider={dialog.rider} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "settle" ? <SettleCash rider={dialog.rider} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function AddRider({ branches, onClose }: { branches: Branch[]; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [pin, setPin] = useState(randomPin);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ phone: string; pin: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <Modal
      open
      onClose={onClose}
      title={done ? "Rider added" : "Add rider"}
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await addRiderAction({ name, phone, branchId, pin });
                  if (!r.ok) {
                    setError(r.error);
                    setErrors(r.fieldErrors ?? {});
                    return;
                  }
                  toast({ title: "Rider added" });
                  setDone({ phone, pin });
                  router.refresh();
                })
              }
            >
              Add rider
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col gap-2" data-testid="rider-login-details">
          <p>Give these to the rider. They log in at <strong>/rider/login</strong>:</p>
          <p className="rounded-control bg-subtle p-3 text-lg">
            Phone: <strong>{done.phone}</strong>
            <br />
            PIN: <strong className="tracking-widest">{done.pin}</strong>
          </p>
          <p className="text-sm text-muted">The PIN is not shown again. You can reset it any time.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error ? <Alert>{error}</Alert> : null}
          <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <Input label="Phone number" required type="tel" inputMode="tel" placeholder="0300 1234567" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
          {branches.length > 1 ? (
            <Select label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} value={branchId} onChange={(e) => setBranchId(e.target.value)} error={errors.branchId} />
          ) : null}
          <div className="flex items-end gap-2">
            <Input
              label="6-digit PIN"
              required
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              error={errors.pin}
              wrapperClassName="flex-1"
            />
            <Button variant="secondary" icon={<Shuffle />} onClick={() => setPin(randomPin())}>
              New PIN
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function EditRider({ rider, branches, onClose }: { rider: RiderSummary; branches: Branch[]; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(rider.name);
  const [branchId, setBranchId] = useState(rider.branchId);
  const [isActive, setIsActive] = useState(rider.isActive);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${rider.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await updateRiderAction({ riderId: rider.id, name, branchId, isActive });
                if (!r.ok) return setError(r.error);
                toast({ title: r.message ?? "Saved" });
                onClose();
                router.refresh();
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        {branches.length > 1 ? (
          <Select label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        ) : null}
        <Switch
          checked={isActive}
          onCheckedChange={setIsActive}
          tone="success"
          label="Rider can log in and get orders"
          description={<span className="block text-sm text-muted">Switch off when a rider leaves. They are logged out at once.</span>}
        />
      </div>
    </Modal>
  );
}

function ResetPin({ rider, onClose }: { rider: RiderSummary; onClose: () => void }) {
  const { toast } = useToast();
  const [pin, setPin] = useState(randomPin);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Modal
      open
      onClose={onClose}
      title={`New PIN for ${rider.name}`}
      footer={
        saved ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await resetRiderPinAction({ riderId: rider.id, pin });
                  if (!r.ok) return setError(r.error);
                  toast({ title: "New PIN saved" });
                  setSaved(true);
                })
              }
            >
              Save PIN
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        {saved ? (
          <p className="rounded-control bg-subtle p-3 text-lg">
            Tell {rider.name} the new PIN: <strong className="tracking-widest">{pin}</strong>
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <Input label="6-digit PIN" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} wrapperClassName="flex-1" />
            <Button variant="secondary" icon={<Shuffle />} onClick={() => setPin(randomPin())}>
              New PIN
            </Button>
          </div>
        )}
        <p className="text-sm text-muted">This also unlocks the login if the rider typed a wrong PIN too many times.</p>
      </div>
    </Modal>
  );
}

function SettleCash({ rider, onClose }: { rider: RiderSummary; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<{ unsettled: UnsettledOrder[]; history: Settlement[] } | null>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let alive = true;
    void fetchRiderCashAction(rider.id).then((d) => {
      if (!alive) return;
      setData(d);
      if (d) setAmount(paisaToInput(d.unsettled.reduce((s, o) => s + o.amount, 0)));
    });
    return () => {
      alive = false;
    };
  }, [rider.id]);
  const loading = data === null;
  const expected = data?.unsettled.reduce((s, o) => s + o.amount, 0) ?? 0;
  const received = parseRupees(amount || "0");

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Settle cash · ${rider.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={pending}
            disabled={!data?.unsettled.length || received === null}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await settleRiderCashAction({ riderId: rider.id, orderIds: data!.unsettled.map((o) => o.id), amount: received!, notes });
                if (!r.ok) return setError(r.error);
                toast({ title: `Cash settled: ${formatPKR(received!)}` });
                onClose();
                router.refresh();
              })
            }
          >
            Confirm received
          </Button>
        </>
      }
    >
      {loading || !data ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="settle-cash">
          {error ? <Alert>{error}</Alert> : null}
          {data.unsettled.length === 0 ? (
            <p className="text-muted">No cash to settle.</p>
          ) : (
            <>
              <ul className="divide-y divide-line rounded-card border border-line">
                {data.unsettled.map((o) => (
                  <li key={o.id} className="flex items-center justify-between p-3">
                    <span className="font-semibold">#{o.orderNumber}</span>
                    <span className="text-sm text-muted">{o.deliveredAt ? formatDateTime(o.deliveredAt) : ""}</span>
                    <span className={o.amount !== o.total ? "font-bold text-status-awaiting-fg" : "font-bold"}>{formatPKR(o.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="flex justify-between text-lg font-bold">
                <span>Total to receive</span>
                <span data-testid="settle-expected">{formatPKR(expected)}</span>
              </p>
              <MoneyInput label="Cash received" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {received !== null && received !== expected ? (
                <Input label="Why is it different?" value={notes} onChange={(e) => setNotes(e.target.value)} required />
              ) : null}
            </>
          )}
          {data.history.length ? (
            <div>
              <h3 className="mb-2 font-bold">Past settlements</h3>
              <ul className="divide-y divide-line text-sm">
                {data.history.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <span>{formatDateTime(s.createdAt)}</span>
                    <span>{s.orderCount} orders</span>
                    <span className="font-semibold">
                      {formatPKR(s.amount)}
                      {s.amount !== s.expectedAmount ? <span className="ms-1 text-status-awaiting-fg">(of {formatPKR(s.expectedAmount)})</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
