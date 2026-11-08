"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { STATUS_MESSAGE_KEYS, STATUS_MESSAGE_LABELS, orderStatusMessage, type StatusMessageKey } from "@/lib/whatsapp/order-messages";
import { saveStatusMessagesAction } from "@/lib/whatsapp/settings-actions";

/** The example text the customer gets, so owners know what they are switching. */
function example(key: StatusMessageKey) {
  return orderStatusMessage({ status: key, orderNumber: 1045, orderType: "pickup", minutes: 25, cancelReason: "out_of_stock" })?.split("\n")[0];
}

export function StatusMessagesForm({ initial, canEdit }: { initial: Record<string, boolean>; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const changed = STATUS_MESSAGE_KEYS.some((k) => values[k] !== initial[k]);

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert>{error}</Alert> : null}
      <ul className="flex flex-col divide-y divide-line">
        {STATUS_MESSAGE_KEYS.map((key) => (
          <li key={key} className="py-2">
            <Switch
              tone="success"
              checked={values[key]}
              onCheckedChange={(on) => setValues((v) => ({ ...v, [key]: on }))}
              disabled={!canEdit}
              label={STATUS_MESSAGE_LABELS[key]}
              description={<span className="block text-xs text-muted">{example(key)}</span>}
            />
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div>
          <Button
            loading={saving}
            disabled={!changed}
            onClick={() =>
              startSaving(async () => {
                setError(null);
                const result = await saveStatusMessagesAction(values);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                toast({ title: "Message settings saved" });
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
    </div>
  );
}
