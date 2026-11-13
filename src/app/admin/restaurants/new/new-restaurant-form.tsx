"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createRestaurantForClientAction } from "@/lib/admin/actions";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function NewRestaurantForm({ plans, defaultTrialDays }: { plans: { id: string; name: string }[]; defaultTrialDays: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    name: "",
    slug: "",
    city: "",
    phone: "",
    branchName: "Main branch",
    ownerName: "",
    ownerEmail: "",
    tempPassword: randomPassword(),
    planId: plans[0]?.id ?? "",
    trialDays: String(defaultTrialDays),
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  return (
    <Card padding="lg" className="max-w-2xl">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await createRestaurantForClientAction({
              ...v,
              planId: v.planId || null,
              trialDays: Number(v.trialDays) || 0,
            });
            if (!r.ok) {
              setError(r.error);
              setErrors(r.fieldErrors ?? {});
              return;
            }
            toast({ title: "Restaurant created. Send the owner their email and temporary password." });
            router.push(`/admin/restaurants/${r.data?.restaurantId}`);
          });
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        <h2 className="text-lg font-bold">Restaurant</h2>
        <Input
          label="Restaurant name"
          value={v.name}
          error={errors.name}
          onChange={(e) => {
            const name = e.target.value;
            setV((x) => ({ ...x, name, slug: slugTouched ? x.slug : slugify(name) }));
          }}
          required
        />
        <Input
          label="Menu link"
          hint={`Customers will open /m/${v.slug || "your-link"}`}
          value={v.slug}
          error={errors.slug}
          onChange={(e) => {
            setSlugTouched(true);
            setV((x) => ({ ...x, slug: slugify(e.target.value) }));
          }}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="City" value={v.city} onChange={set("city")} error={errors.city} />
          <Input label="Restaurant phone" inputMode="tel" value={v.phone} onChange={set("phone")} error={errors.phone} />
        </div>
        <Input label="First branch name" value={v.branchName} onChange={set("branchName")} error={errors.branchName} required />

        <h2 className="mt-2 text-lg font-bold">Owner login</h2>
        <Input label="Owner's name" value={v.ownerName} onChange={set("ownerName")} error={errors.ownerName} required />
        <Input label="Owner's email" type="email" value={v.ownerEmail} onChange={set("ownerEmail")} error={errors.ownerEmail} required />
        <Input
          label="Temporary password"
          value={v.tempPassword}
          onChange={set("tempPassword")}
          error={errors.tempPassword}
          hint="Send it to the owner. They must change it the first time they log in."
          required
        />

        <h2 className="mt-2 text-lg font-bold">Plan</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Plan" value={v.planId} onChange={set("planId")} options={plans.map((p) => ({ value: p.id, label: p.name }))} placeholder="No plan yet" />
          <Input label="Free trial (days)" inputMode="numeric" value={v.trialDays} onChange={(e) => setV((x) => ({ ...x, trialDays: e.target.value.replace(/\D/g, "") }))} error={errors.trialDays} />
        </div>
        <Button type="submit" loading={pending} size="lg">
          Create restaurant
        </Button>
      </form>
    </Card>
  );
}
