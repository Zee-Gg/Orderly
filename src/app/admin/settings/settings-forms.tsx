"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { savePlanAction, savePlatformSettingsAction } from "@/lib/admin/actions";
import { limitText, type Plan } from "@/lib/billing/core";
import type { PlatformSettings } from "@/lib/billing/queries";
import { formatPKR } from "@/lib/money";

const digits = (s: string) => s.replace(/\D/g, "");

export function PlatformSettingsForm({ settings }: { settings: PlatformSettings }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    defaultTrialDays: String(settings.defaultTrialDays),
    gracePeriodDays: String(settings.gracePeriodDays),
    paymentInstructions: settings.paymentInstructions ?? "",
    salesWhatsapp: settings.salesWhatsapp ?? "",
    supportPhone: settings.supportPhone ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>Platform settings</CardTitle>
      </CardHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await savePlatformSettingsAction({
              ...v,
              defaultTrialDays: Number(v.defaultTrialDays) || 0,
              gracePeriodDays: Number(v.gracePeriodDays) || 0,
            });
            setErrors(r.ok ? {} : (r.fieldErrors ?? {}));
            toast(r.ok ? { title: "Saved" } : { title: r.error, tone: "error" });
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Free trial (days)" inputMode="numeric" value={v.defaultTrialDays} onChange={(e) => setV((x) => ({ ...x, defaultTrialDays: digits(e.target.value) }))} error={errors.defaultTrialDays} />
          <Input
            label="Grace period (days)"
            hint="After the due date, before suspending."
            inputMode="numeric"
            value={v.gracePeriodDays}
            onChange={(e) => setV((x) => ({ ...x, gracePeriodDays: digits(e.target.value) }))}
            error={errors.gracePeriodDays}
          />
        </div>
        <Textarea
          label="How to pay (shown to owners)"
          rows={5}
          value={v.paymentInstructions}
          onChange={(e) => setV((x) => ({ ...x, paymentInstructions: e.target.value }))}
          placeholder={"Bank: Meezan Bank\nAccount title: ...\nIBAN: PK..\nJazzCash / Easypaisa: 0300-...."}
          error={errors.paymentInstructions}
        />
        <Input
          label="Your WhatsApp number (landing page “Book a demo”)"
          inputMode="tel"
          value={v.salesWhatsapp}
          onChange={(e) => setV((x) => ({ ...x, salesWhatsapp: e.target.value }))}
          placeholder="923001234567"
          error={errors.salesWhatsapp}
        />
        <Input
          label="Support phone (shown when an account is suspended)"
          inputMode="tel"
          value={v.supportPhone}
          onChange={(e) => setV((x) => ({ ...x, supportPhone: e.target.value }))}
          error={errors.supportPhone}
        />
        <div>
          <Button type="submit" loading={pending}>
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}

type PlanForm = {
  id: string | null;
  name: string;
  description: string;
  monthlyPrice: string;
  maxBranches: string;
  maxOrdersPerMonth: string;
  maxBotConversationsPerMonth: string;
  isActive: boolean;
  sortOrder: string;
};

function toForm(p: Plan | null): PlanForm {
  return {
    id: p?.id ?? null,
    name: p?.name ?? "",
    description: p?.description ?? "",
    monthlyPrice: p ? String(p.monthlyPrice / 100) : "",
    maxBranches: String(p?.maxBranches ?? 1),
    maxOrdersPerMonth: p?.maxOrdersPerMonth ? String(p.maxOrdersPerMonth) : "",
    maxBotConversationsPerMonth: p?.maxBotConversationsPerMonth ? String(p.maxBotConversationsPerMonth) : "",
    isActive: p?.isActive ?? true,
    sortOrder: String(p?.sortOrder ?? 0),
  };
}

export function PlansEditor({ plans }: { plans: Plan[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<PlanForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <Button
          icon={<Plus />}
          onClick={() => {
            setError(null);
            setErrors({});
            setForm(toForm(null));
          }}
        >
          Add plan
        </Button>
      </CardHeader>
      {plans.length === 0 ? (
        <p className="rounded-control border-2 border-dashed border-line px-4 py-6 text-center text-muted">
          No plans yet. Run <code>npm run seed:plans</code> or add one here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line" data-testid="plans">
          {plans.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="font-bold">
                  {p.name} · {formatPKR(p.monthlyPrice)}/month
                </span>
                {p.isActive ? null : <span className="ml-2 rounded-full bg-subtle px-2 text-xs">hidden</span>}
                <span className="block text-sm text-muted">
                  {p.maxBranches} branch{p.maxBranches === 1 ? "" : "es"} · {limitText(p.maxOrdersPerMonth)} orders · {limitText(p.maxBotConversationsPerMonth)} bot chats a month
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${p.name}`}
                onClick={() => {
                  setError(null);
                  setErrors({});
                  setForm(toForm(p));
                }}
              >
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? `Edit ${form.name}` : "New plan"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                form &&
                start(async () => {
                  const r = await savePlanAction({
                    id: form.id,
                    name: form.name,
                    description: form.description,
                    monthlyPrice: form.monthlyPrice,
                    maxBranches: Number(form.maxBranches) || 1,
                    maxOrdersPerMonth: form.maxOrdersPerMonth ? Number(form.maxOrdersPerMonth) : null,
                    maxBotConversationsPerMonth: form.maxBotConversationsPerMonth ? Number(form.maxBotConversationsPerMonth) : null,
                    isActive: form.isActive,
                    sortOrder: Number(form.sortOrder) || 0,
                  });
                  if (!r.ok) {
                    setError(r.error);
                    setErrors(r.fieldErrors ?? {});
                    return;
                  }
                  toast({ title: "Plan saved" });
                  setForm(null);
                  router.refresh();
                })
              }
            >
              Save
            </Button>
          </>
        }
      >
        {form ? (
          <div className="flex flex-col gap-3">
            {error ? <Alert>{error}</Alert> : null}
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
            <Input label="Short description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Input label="Price per month (Rs)" inputMode="decimal" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} error={errors.monthlyPrice} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Branches" inputMode="numeric" value={form.maxBranches} onChange={(e) => setForm({ ...form, maxBranches: digits(e.target.value) })} />
              <Input label="Orders / month" hint="Empty = unlimited" inputMode="numeric" value={form.maxOrdersPerMonth} onChange={(e) => setForm({ ...form, maxOrdersPerMonth: digits(e.target.value) })} />
              <Input
                label="Bot chats / month"
                hint="Empty = unlimited"
                inputMode="numeric"
                value={form.maxBotConversationsPerMonth}
                onChange={(e) => setForm({ ...form, maxBotConversationsPerMonth: digits(e.target.value) })}
              />
            </div>
            <Input label="Order on the page" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: digits(e.target.value) })} />
            <Switch label="Show on the pricing page" checked={form.isActive} onCheckedChange={(on) => setForm({ ...form, isActive: on })} />
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
