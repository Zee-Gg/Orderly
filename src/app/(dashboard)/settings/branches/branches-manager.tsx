"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bike, Clock, MapPin, Pencil, Phone, Plus } from "lucide-react";
import { OpeningHoursEditor } from "@/components/restaurant/opening-hours-editor";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createBranch, setBranchOpen, updateBranch } from "@/lib/branches/actions";
import { formatPKR, paisaToInput, parseRupees } from "@/lib/money";
import { DEFAULT_OPENING_HOURS, summarizeOpeningHours, type OpeningHours } from "@/lib/opening-hours";

export type BranchRow = {
  id: string;
  name: string;
  address: string;
  area: string;
  city: string;
  phone: string;
  isOpen: boolean;
  isActive: boolean;
  openingHours: OpeningHours;
  /** Paisa. */
  deliveryFee: number;
  minimumOrder: number;
};

/** Money fields are edited as rupee text and converted on save. */
type FormValues = Omit<BranchRow, "id" | "isOpen" | "deliveryFee" | "minimumOrder"> & { deliveryFee: string; minimumOrder: string };

const toForm = (b: BranchRow): FormValues => ({
  name: b.name,
  address: b.address,
  area: b.area,
  city: b.city,
  phone: b.phone,
  isActive: b.isActive,
  openingHours: b.openingHours,
  deliveryFee: paisaToInput(b.deliveryFee),
  minimumOrder: paisaToInput(b.minimumOrder),
});

function BranchForm({
  initial,
  branchId,
  onDone,
}: {
  initial: FormValues;
  branchId: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function save() {
    setFormError(null);
    const deliveryFee = values.deliveryFee.trim() ? parseRupees(values.deliveryFee) : 0;
    const minimumOrder = values.minimumOrder.trim() ? parseRupees(values.minimumOrder) : 0;
    if (deliveryFee === null || minimumOrder === null) {
      setErrors({
        ...(deliveryFee === null ? { deliveryFee: "Enter an amount like 150" } : {}),
        ...(minimumOrder === null ? { minimumOrder: "Enter an amount like 500" } : {}),
      });
      return;
    }
    const input = { ...values, deliveryFee, minimumOrder };
    startSaving(async () => {
      const result = branchId ? await updateBranch(branchId, input) : await createBranch(input);
      if (!result.ok) {
        setFormError(result.error);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      toast({ title: branchId ? "Branch saved" : `${values.name} added` });
      router.refresh();
      onDone();
    });
  }

  return (
    <form
      id="branch-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      {formError ? <Alert>{formError}</Alert> : null}
      <Input label="Branch name" value={values.name} onChange={(e) => set("name", e.target.value)} required error={errors.name} />
      <Input label="Area" value={values.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Gulberg III" error={errors.area} />
      <Textarea label="Address" value={values.address} onChange={(e) => set("address", e.target.value)} rows={2} error={errors.address} />
      <Input label="City" value={values.city} onChange={(e) => set("city", e.target.value)} error={errors.city} />
      <Input
        label="Branch phone"
        type="tel"
        inputMode="tel"
        value={values.phone}
        onChange={(e) => set("phone", e.target.value)}
        placeholder="0300-1234567"
        error={errors.phone}
      />
      <div className="grid grid-cols-2 gap-3">
        <MoneyInput
          label="Delivery fee"
          value={values.deliveryFee}
          onChange={(e) => set("deliveryFee", e.target.value)}
          placeholder="0"
          error={errors.deliveryFee}
        />
        <MoneyInput
          label="Minimum order for delivery"
          value={values.minimumOrder}
          onChange={(e) => set("minimumOrder", e.target.value)}
          placeholder="0"
          error={errors.minimumOrder}
        />
      </div>
      <div>
        <h3 className="mb-3 text-base font-bold">Opening hours</h3>
        <OpeningHoursEditor
          value={values.openingHours}
          onChange={(h) => set("openingHours", h)}
          errors={Object.fromEntries(
            Object.entries(errors)
              .filter(([k]) => k.startsWith("openingHours."))
              .map(([k, v]) => [k.replace("openingHours.", ""), v]),
          )}
          disabled={saving}
        />
      </div>
      {branchId ? (
        <Switch
          checked={values.isActive}
          onCheckedChange={(v) => set("isActive", v)}
          label="Branch is in use"
          description={values.isActive ? "Shown everywhere" : "Hidden from staff and customers"}
        />
      ) : null}
      <Button type="submit" size="lg" loading={saving} fullWidth>
        {branchId ? "Save branch" : "Add branch"}
      </Button>
    </form>
  );
}

function OpenSwitch({ branch }: { branch: BranchRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Switch
      tone="success"
      checked={branch.isOpen}
      disabled={pending || !branch.isActive}
      label={branch.isOpen ? "Open" : "Closed"}
      onCheckedChange={(open) =>
        startTransition(async () => {
          const result = await setBranchOpen(branch.id, open);
          if (!result.ok) toast({ title: result.error, tone: "error" });
          router.refresh();
        })
      }
    />
  );
}

export function BranchesManager({
  branches,
  canAdd,
  defaultCity,
}: {
  branches: BranchRow[];
  canAdd: boolean;
  defaultCity: string;
}) {
  const [editing, setEditing] = useState<BranchRow | "new" | null>(null);

  const newValues: FormValues = {
    name: "",
    address: "",
    area: "",
    city: defaultCity,
    phone: "",
    isActive: true,
    openingHours: DEFAULT_OPENING_HOURS,
    deliveryFee: "",
    minimumOrder: "",
  };

  return (
    <div className="flex flex-col gap-4">
      {canAdd ? (
        <Button icon={<Plus />} onClick={() => setEditing("new")} className="self-start">
          Add branch
        </Button>
      ) : null}

      {branches.length === 0 ? (
        <EmptyState icon={<MapPin />} title="No branches" description="Add your first branch to start taking orders." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {branches.map((b) => (
            <Card key={b.id} className={b.isActive ? undefined : "opacity-70"}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-bold">{b.name}</h3>
                  {b.area ? <p className="text-sm text-muted">{b.area}</p> : null}
                </div>
                {b.isActive ? null : <Badge tone="delivered">Not in use</Badge>}
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm text-muted">
                {b.address ? (
                  <li className="flex gap-2">
                    <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {b.address}
                  </li>
                ) : null}
                {b.phone ? (
                  <li className="flex gap-2">
                    <Phone aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {b.phone}
                  </li>
                ) : null}
                <li className="flex gap-2">
                  <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {summarizeOpeningHours(b.openingHours)}
                </li>
                <li className="flex gap-2">
                  <Bike aria-hidden className="mt-0.5 size-4 shrink-0" />
                  Delivery fee {formatPKR(b.deliveryFee)}
                  {b.minimumOrder ? ` · minimum order ${formatPKR(b.minimumOrder)}` : ""}
                </li>
              </ul>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                <OpenSwitch branch={b} />
                <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(b)}>
                  Edit
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add branch" : `Edit ${editing?.name ?? "branch"}`}
      >
        {editing ? (
          <BranchForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? newValues : toForm(editing)}
            branchId={editing === "new" ? null : editing.id}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}
