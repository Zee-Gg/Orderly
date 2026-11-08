"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { savePrintSettingsAction } from "@/lib/print/actions";
import type { PaperWidth } from "@/lib/print/types";

export function PrintingForm({
  initial,
  canEdit,
}: {
  initial: { width: PaperWidth; header: string | null; footer: string | null };
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [width, setWidth] = useState<PaperWidth>(initial.width);
  const [header, setHeader] = useState(initial.header ?? "");
  const [footer, setFooter] = useState(initial.footer ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Alert tone="info" title="How printing works">
        Orderly prints through your browser. On the computer next to the printer, open Windows Settings → Bluetooth &amp;
        devices → Printers, choose your thermal printer and tap “Set as default”. Then “Print bill” and “Print KOT” will go
        straight to it. In the print window, set Margins to “None” the first time.
      </Alert>

      {error ? <Alert>{error}</Alert> : null}
      <Card padding="lg" className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-sm font-semibold">Paper width</p>
          <Tabs
            variant="segmented"
            aria-label="Paper width"
            value={width}
            onValueChange={setWidth}
            items={[
              { value: "80mm", label: "80 mm (most common)" },
              { value: "58mm", label: "58 mm (small)" },
            ]}
          />
        </div>
        <Textarea
          label="Bill header (optional)"
          value={header}
          onChange={(e) => setHeader(e.target.value)}
          rows={2}
          maxLength={300}
          disabled={!canEdit}
          placeholder="e.g. NTN 1234567 · Free delivery over Rs 2,000"
          hint="Printed under your restaurant name on bills."
        />
        <Textarea
          label="Bill footer (optional)"
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
          rows={2}
          maxLength={300}
          disabled={!canEdit}
          placeholder="e.g. Thank you! Order again on WhatsApp 0300-1234567"
          hint="Printed at the bottom of every bill."
        />
        <div className="flex flex-wrap gap-3">
          {canEdit ? (
            <Button
              loading={saving}
              onClick={() =>
                startSaving(async () => {
                  setError(null);
                  const result = await savePrintSettingsAction({ width, header, footer });
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  toast({ title: "Printing settings saved" });
                  router.refresh();
                })
              }
            >
              Save
            </Button>
          ) : null}
          <Button variant="secondary" icon={<Printer />} onClick={() => window.open(`/print/test?width=${width.replace("mm", "")}`, "_blank", "noopener")}>
            Print test slip
          </Button>
        </div>
        {!canEdit ? <p className="text-sm text-muted">Only the owner can change these settings.</p> : null}
      </Card>
    </div>
  );
}
