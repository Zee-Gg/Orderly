"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { LogoPicker } from "@/components/restaurant/logo-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { setRestaurantLogo, updateRestaurantProfile } from "@/lib/restaurants/actions";
import { uploadLogo } from "@/lib/restaurants/logo-upload";

type Restaurant = {
  id: string;
  name: string;
  slug: string;
  city: string;
  phone: string;
  whatsappNumber: string;
  logoUrl: string;
};

export function RestaurantForm({ restaurant }: { restaurant: Restaurant }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(restaurant);
  const [logo, setLogo] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const set = (key: keyof Restaurant, value: string) => setValues((v) => ({ ...v, [key]: value }));

  function save(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setErrors({});
    startSaving(async () => {
      let logoUrl = values.logoUrl;
      if (logo) {
        try {
          const saved = await setRestaurantLogo(await uploadLogo(restaurant.id, logo));
          if (!saved.ok) throw new Error(saved.error);
          logoUrl = saved.data!.url;
          setLogo(null);
          setValues((v) => ({ ...v, logoUrl }));
        } catch (err) {
          setFormError(err instanceof Error ? err.message : "Couldn't upload the logo.");
          return;
        }
      }
      const result = await updateRestaurantProfile({ ...values, logoUrl });
      if (!result.ok) {
        setFormError(result.error);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      toast({ title: "Restaurant details saved" });
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} noValidate className="flex max-w-2xl flex-col gap-6">
      {formError ? <Alert>{formError}</Alert> : null}
      <Card padding="lg" className="flex flex-col gap-4">
        <Input
          label="Restaurant name"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          required
          error={errors.name}
        />
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink">Menu link</p>
          <p className="flex min-h-touch items-center gap-2 rounded-control bg-subtle px-3.5 text-base text-muted">
            <Link2 aria-hidden className="size-5" />/m/{restaurant.slug}
          </p>
          <p className="mt-1.5 text-sm text-muted">The link can&apos;t be changed, so printed menus keep working.</p>
        </div>
        <Input label="City" value={values.city} onChange={(e) => set("city", e.target.value)} error={errors.city} />
        <Input
          label="Restaurant phone"
          type="tel"
          inputMode="tel"
          value={values.phone}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="0300-1234567"
          error={errors.phone}
        />
        <Input
          label="WhatsApp number for orders"
          type="tel"
          inputMode="tel"
          value={values.whatsappNumber}
          onChange={(e) => set("whatsappNumber", e.target.value)}
          placeholder="0300-1234567"
          hint="Connecting WhatsApp comes in a later step."
          error={errors.whatsappNumber}
        />
        <LogoPicker currentUrl={values.logoUrl || null} file={logo} onFileChange={setLogo} disabled={saving} />
        {errors.logoUrl ? <p className="text-sm text-danger">{errors.logoUrl}</p> : null}
      </Card>
      <Button type="submit" size="lg" loading={saving} className="self-start">
        Save changes
      </Button>
    </form>
  );
}
