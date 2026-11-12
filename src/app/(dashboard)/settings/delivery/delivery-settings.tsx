"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Pencil, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipInput } from "@/components/ui/chip-input";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { DragHandle, SortableList } from "@/components/ui/sortable-list";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { reorderZonesAction, saveDeliverySettingsAction, saveShareRiderPhoneAction, saveZoneAction } from "@/lib/delivery/actions";
import type { DeliveryZone } from "@/lib/delivery/zones";
import { formatPKR, paisaToInput, parseRupees } from "@/lib/money";

export type BranchDelivery = {
  id: string;
  name: string;
  defaultFee: number;
  defaultMinimum: number;
  maxRadiusKm: number | null;
  unlistedPolicy: "reject" | "default_fee";
  hasPin: boolean;
  zones: DeliveryZone[];
};

export function DeliverySettings({ branches, shareRiderPhone, canEditRestaurant }: { branches: BranchDelivery[]; shareRiderPhone: boolean; canEditRestaurant: boolean }) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {branches.map((b) => (
        <BranchZones key={b.id} branch={b} />
      ))}
      <ShareRiderPhone initial={shareRiderPhone} canEdit={canEditRestaurant} />
    </div>
  );
}

function BranchZones({ branch }: { branch: BranchDelivery }) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState(branch.zones);
  const [synced, setSynced] = useState(branch.zones);
  if (synced !== branch.zones) {
    setSynced(branch.zones);
    setRows(branch.zones);
  }
  const [editing, setEditing] = useState<DeliveryZone | "new" | null>(null);
  const [radius, setRadius] = useState(branch.maxRadiusKm ? String(branch.maxRadiusKm) : "");
  const [policy, setPolicy] = useState(branch.unlistedPolicy);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`b-${branch.id}`} data-testid="branch-zones">
      <h2 id={`b-${branch.id}`} className="flex items-center gap-2 text-xl font-bold">
        <MapPin aria-hidden className="size-5" /> {branch.name}
      </h2>
      <Card padding="lg" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted">
            Areas you deliver to. The bot and your staff use the area&apos;s fee and minimum order. Other names help match how customers write it (“dha 5”, “phase 5”).
          </p>
          <Button icon={<Plus />} onClick={() => setEditing("new")}>
            Add area
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-control bg-subtle p-3 text-sm">No areas yet — every address gets the branch delivery fee ({formatPKR(branch.defaultFee)}).</p>
        ) : (
          <SortableList
            id={`zones-${branch.id}`}
            items={rows}
            onReorder={(next) => {
              setRows(next);
              start(async () => {
                const r = await reorderZonesAction(next.map((z) => z.id));
                if (!r.ok) {
                  toast({ title: r.error, tone: "error" });
                  setRows(branch.zones);
                }
              });
            }}
            className="flex flex-col gap-2"
          >
            {(z, { handle }) => (
              <div className={`flex items-center gap-2 rounded-card border border-line p-2 ${z.isActive ? "" : "opacity-60"}`} data-testid="zone-row">
                <DragHandle handle={handle} label={`Move ${z.name}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {z.name} {!z.isActive ? <Badge tone="delivered">Off</Badge> : null}
                  </p>
                  <p className="text-sm text-muted">
                    Fee {formatPKR(z.deliveryFee)}
                    {z.minimumOrder ? ` · min ${formatPKR(z.minimumOrder)}` : ""}
                    {z.estimatedMinutes ? ` · ~${z.estimatedMinutes} min` : ""}
                    {z.aliases.length ? ` · also: ${z.aliases.join(", ")}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Edit ${z.name}`} onClick={() => setEditing(z)}>
                  <Pencil />
                </Button>
              </div>
            )}
          </SortableList>
        )}
      </Card>

      <Card padding="lg" className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <Select
          label="Address not in your list"
          value={policy}
          onChange={(e) => setPolicy(e.target.value as BranchDelivery["unlistedPolicy"])}
          options={[
            { value: "default_fee", label: `Deliver at ${formatPKR(branch.defaultFee)} and flag the order “Area not in list — check”` },
            { value: "reject", label: "Don't deliver (the bot offers pickup)" },
          ]}
        />
        <Input
          label="Maximum delivery distance (km, optional)"
          inputMode="decimal"
          value={radius}
          onChange={(e) => setRadius(e.target.value.replace(/[^\d.]/g, ""))}
          hint={branch.hasPin ? "Checked when the customer shares a location pin." : "Set the branch location pin in Bot knowledge → Restaurant info for this to work."}
          wrapperClassName="max-w-xs"
        />
        <div>
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const km = radius ? Number(radius) : null;
                if (km !== null && (!Number.isFinite(km) || km < 0.5)) return setError("Enter a distance like 8");
                const r = await saveDeliverySettingsAction({ branchId: branch.id, maxDeliveryRadiusKm: km, unlistedAreaPolicy: policy });
                if (!r.ok) return setError(r.error);
                toast({ title: "Saved" });
                router.refresh();
              })
            }
          >
            Save {branch.name}
          </Button>
        </div>
      </Card>

      {editing ? <ZoneDialog branchId={branch.id} zone={editing === "new" ? null : editing} defaults={branch} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function ZoneDialog({ branchId, zone, defaults, onClose }: { branchId: string; zone: DeliveryZone | null; defaults: BranchDelivery; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(zone?.name ?? "");
  const [aliases, setAliases] = useState<string[]>(zone?.aliases ?? []);
  const [fee, setFee] = useState(paisaToInput(zone?.deliveryFee ?? defaults.defaultFee));
  const [minimum, setMinimum] = useState(paisaToInput(zone?.minimumOrder ?? defaults.defaultMinimum));
  const [eta, setEta] = useState(zone?.estimatedMinutes ? String(zone.estimatedMinutes) : "");
  const [isActive, setIsActive] = useState(zone?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Modal
      open
      onClose={onClose}
      title={zone ? `Edit ${zone.name}` : "New delivery area"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={() => {
              const feePaisa = parseRupees(fee || "0");
              const minPaisa = parseRupees(minimum || "0");
              if (feePaisa === null) return setErrors({ deliveryFee: "Enter an amount like 150" });
              if (minPaisa === null) return setErrors({ minimumOrder: "Enter an amount like 800" });
              start(async () => {
                setError(null);
                const r = await saveZoneAction({
                  id: zone?.id ?? null,
                  branchId,
                  name,
                  aliases,
                  deliveryFee: feePaisa,
                  minimumOrder: minPaisa,
                  estimatedMinutes: eta ? Number(eta) : null,
                  isActive,
                });
                if (!r.ok) {
                  setError(r.error);
                  setErrors(r.fieldErrors ?? {});
                  return;
                }
                toast({ title: r.message ?? "Saved" });
                onClose();
                router.refresh();
              });
            }}
          >
            Save area
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Input label="Area name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="DHA Phase 5" />
        <ChipInput label="Other names customers use" hint="e.g. dha 5, phase 5, defence 5" value={aliases} onChange={setAliases} maxItems={30} maxLength={60} />
        <div className="grid grid-cols-2 gap-3">
          <MoneyInput label="Delivery fee" value={fee} onChange={(e) => setFee(e.target.value)} error={errors.deliveryFee} />
          <MoneyInput label="Minimum order" value={minimum} onChange={(e) => setMinimum(e.target.value)} error={errors.minimumOrder} />
        </div>
        <Input label="Delivery time (minutes, optional)" inputMode="numeric" value={eta} onChange={(e) => setEta(e.target.value.replace(/\D/g, ""))} wrapperClassName="max-w-xs" />
        <Switch checked={isActive} onCheckedChange={setIsActive} tone="success" label="We deliver here" description={<span className="block text-sm text-muted">Switch off instead of deleting.</span>} />
      </div>
    </Modal>
  );
}

function ShareRiderPhone({ initial, canEdit }: { initial: boolean; canEdit: boolean }) {
  const { toast } = useToast();
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <Card padding="lg">
      <Switch
        checked={on}
        disabled={!canEdit || pending}
        onCheckedChange={(v) => {
          setOn(v);
          start(async () => {
            const r = await saveShareRiderPhoneAction(v);
            if (!r.ok) {
              setOn(!v);
              toast({ title: r.error, tone: "error" });
            }
          });
        }}
        label="Send the rider's phone number to the customer"
        description={<span className="block text-sm text-muted">In the “order on the way” WhatsApp message. The rider&apos;s name is always sent.</span>}
      />
    </Card>
  );
}
