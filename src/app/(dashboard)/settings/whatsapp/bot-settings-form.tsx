"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money-input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { paisaToInput, parseRupees } from "@/lib/money";
import { saveBotSettingsAction } from "@/lib/whatsapp/settings-actions";

export function BotSettingsForm({
  initial,
  canEdit,
}: {
  initial: { botEnabled: boolean; highValueCodThreshold: number };
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [botEnabled, setBotEnabled] = useState(initial.botEnabled);
  const [threshold, setThreshold] = useState(paisaToInput(initial.highValueCodThreshold));
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}
      <Switch
        tone="success"
        size="lg"
        checked={botEnabled}
        onCheckedChange={setBotEnabled}
        disabled={!canEdit}
        label="AI bot answers WhatsApp"
        description={
          <span className="block text-sm text-muted">
            {botEnabled ? "The bot takes orders by chat. Staff accept them on Orders." : "Off: customers' messages wait for your staff in Inbox."}
          </span>
        }
      />
      <MoneyInput
        label="Call to confirm cash orders above"
        hint="New customers ordering cash on delivery above this get a “call to confirm” flag on the order."
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
        disabled={!canEdit}
        error={fieldError ?? undefined}
      />
      {canEdit ? (
        <div>
          <Button
            loading={saving}
            onClick={() => {
              const paisa = parseRupees(threshold);
              if (paisa === null) {
                setFieldError("Enter an amount like 5000");
                return;
              }
              setFieldError(null);
              start(async () => {
                setError(null);
                const r = await saveBotSettingsAction({ botEnabled, highValueCodThreshold: paisa });
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                toast({ title: "Bot settings saved" });
                router.refresh();
              });
            }}
          >
            Save
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Only the owner can change these.</p>
      )}
    </div>
  );
}
