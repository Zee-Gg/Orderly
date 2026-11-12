"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, Link2, MapPin } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { mapsLinkFor } from "@/lib/bot/knowledge";
import { resolveMapsLinkAction, saveBranchInfoAction, saveRestaurantBotInfoAction } from "@/lib/bot/knowledge-actions";
import type { BotKnowledge, BranchInfoRow } from "@/lib/bot/knowledge-queries";
import type { BotPaymentMethod } from "@/lib/bot/types";

export function InfoTab({
  branches,
  restaurant,
  canEditRestaurant,
}: {
  branches: BranchInfoRow[];
  restaurant: BotKnowledge["restaurant"];
  canEditRestaurant: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {branches.map((b) => (
        <BranchCard key={b.id} branch={b} />
      ))}
      <RestaurantCard initial={restaurant} canEdit={canEditRestaurant} />
    </div>
  );
}

function BranchCard({ branch }: { branch: BranchInfoRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [address, setAddress] = useState(branch.address ?? "");
  const [area, setArea] = useState(branch.area ?? "");
  const [coords, setCoords] = useState(branch.latitude != null && branch.longitude != null ? { latitude: branch.latitude, longitude: branch.longitude } : null);
  const [mapsUrl, setMapsUrl] = useState(branch.googleMapsUrl ?? "");
  const [delivery, setDelivery] = useState(String(branch.deliveryMinutes));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [pending, start] = useTransition();

  function useCurrentLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("This phone or browser can't share its location. Paste a Google Maps link instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setCoords({ latitude: Math.round(pos.coords.latitude * 1e6) / 1e6, longitude: Math.round(pos.coords.longitude * 1e6) / 1e6 });
        toast({ title: "Location found — tap Save" });
      },
      () => {
        setLocating(false);
        setError("Couldn't get your location. Allow location access, or paste a Google Maps link.");
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  function readLink() {
    setError(null);
    start(async () => {
      const r = await resolveMapsLinkAction(mapsUrl);
      if (!r.ok || !r.data) {
        setError(r.ok ? "Couldn't read the link." : r.error);
        return;
      }
      setCoords({ latitude: r.data.latitude, longitude: r.data.longitude });
      toast({ title: "Location found — tap Save" });
    });
  }

  function save() {
    const minutes = Number(delivery);
    if (!Number.isInteger(minutes) || minutes < 0) {
      setErrors({ deliveryMinutes: "Enter minutes, like 30" });
      return;
    }
    start(async () => {
      setError(null);
      const r = await saveBranchInfoAction({
        branchId: branch.id,
        address,
        area,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        googleMapsUrl: mapsUrl || null,
        deliveryMinutes: minutes,
      });
      if (!r.ok) {
        setError(r.error);
        setErrors(r.fieldErrors ?? {});
        return;
      }
      setErrors({});
      toast({ title: r.message ?? "Saved" });
      router.refresh();
    });
  }

  const total = branch.prepMinutes + (Number(delivery) || 0);

  return (
    <Card padding="lg" className="flex flex-col gap-4" data-testid="branch-info">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <MapPin aria-hidden className="size-5" /> {branch.name}
      </h2>
      {error ? <Alert>{error}</Alert> : null}
      <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} error={errors.address} placeholder="Plot 12, Khayaban-e-Ittehad" />
      <Input label="Area" value={area} onChange={(e) => setArea(e.target.value)} error={errors.area} placeholder="DHA Phase 6" />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Location pin (sent when customers ask “location?”)</p>
        {coords ? (
          <p className="text-sm" data-testid="branch-coords">
            📍 {coords.latitude}, {coords.longitude} ·{" "}
            <a href={mapsLinkFor(coords.latitude, coords.longitude)} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline">
              Check on Google Maps
            </a>
          </p>
        ) : (
          <p className="text-sm text-muted">No pin yet — the bot sends the address as text.</p>
        )}
        <Button variant="secondary" icon={<Crosshair />} loading={locating} onClick={useCurrentLocation}>
          Use my current location (at the restaurant)
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            label="Or paste a Google Maps link"
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            error={errors.googleMapsUrl}
            placeholder="https://maps.app.goo.gl/…"
            wrapperClassName="flex-1"
            inputMode="url"
          />
          <Button variant="secondary" icon={<Link2 />} disabled={!mapsUrl.trim()} loading={pending} onClick={readLink}>
            Read link
          </Button>
        </div>
      </div>

      <Input
        label="Delivery time (minutes, on top of cooking time)"
        type="number"
        inputMode="numeric"
        min={0}
        max={600}
        value={delivery}
        onChange={(e) => setDelivery(e.target.value)}
        error={errors.deliveryMinutes}
        hint={`The bot tells customers delivery takes about ${total} minutes (${branch.prepMinutes} cooking + ${Number(delivery) || 0} delivery).`}
      />
      <div>
        <Button loading={pending} onClick={save}>
          Save {branch.name}
        </Button>
      </div>
    </Card>
  );
}

function RestaurantCard({ initial, canEdit }: { initial: BotKnowledge["restaurant"]; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [dineIn, setDineIn] = useState(initial.dineInAvailable);
  const [payments, setPayments] = useState<BotPaymentMethod[]>(initial.paymentMethods);
  const [greeting, setGreeting] = useState(initial.mentionOfferOnGreeting);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (m: BotPaymentMethod, on: boolean) => setPayments((p) => (on ? [...new Set([...p, m])] : p.filter((x) => x !== m)));

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">What the bot tells customers</h2>
      {error ? <Alert>{error}</Alert> : null}
      <Switch checked={dineIn} onCheckedChange={setDineIn} disabled={!canEdit} label="Dine-in available" />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Ways to pay</legend>
        <Switch checked={payments.includes("cod")} onCheckedChange={(v) => toggle("cod", v)} disabled={!canEdit} label="Cash on delivery" />
        <Switch
          checked={payments.includes("card_on_delivery")}
          onCheckedChange={(v) => toggle("card_on_delivery", v)}
          disabled={!canEdit}
          label="Card on delivery (card machine)"
        />
      </fieldset>
      <Switch
        checked={greeting}
        onCheckedChange={setGreeting}
        disabled={!canEdit}
        tone="success"
        label="Mention today's offer when a new chat starts"
        description={<span className="block text-sm text-muted">One offer, once per chat. Only offers that are active right now.</span>}
      />
      {canEdit ? (
        <div>
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await saveRestaurantBotInfoAction({ dineInAvailable: dineIn, paymentMethods: payments, mentionOfferOnGreeting: greeting });
                if (!r.ok) {
                  setError(r.fieldErrors?.paymentMethods ?? r.error);
                  return;
                }
                toast({ title: r.message ?? "Saved" });
                router.refresh();
              })
            }
          >
            Save
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Only the owner can change these.</p>
      )}
    </Card>
  );
}
