"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageCircle, PlugZap, Unplug, XCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/lib/hooks/use-form-action";
import { formatDateTime } from "@/lib/time";
import {
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  testWhatsAppConnectionAction,
} from "@/lib/whatsapp/admin-actions";

export type AdminRestaurantRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  branches: { id: string; name: string }[];
  account: {
    branchId: string | null;
    phoneNumberId: string;
    wabaId: string;
    displayPhoneNumber: string;
    isActive: boolean;
    connectedAt: string;
  } | null;
};

export function WhatsAppAdmin({ rows }: { rows: AdminRestaurantRow[] }) {
  const [editing, setEditing] = useState<AdminRestaurantRow | null>(null);
  const [disconnecting, setDisconnecting] = useState<AdminRestaurantRow | null>(null);

  if (rows.length === 0) {
    return <EmptyState tone="neutral" icon={<MessageCircle />} title="No restaurants yet" description="Restaurants appear here after sign-up." />;
  }

  return (
    <>
      <Alert tone="info" title="Webhook URL for Meta">
        Callback URL: <code className="font-mono">https://YOUR-DOMAIN/api/webhooks/whatsapp</code> · Verify token: the
        value of WHATSAPP_VERIFY_TOKEN · Subscribe to the <b>messages</b> field.
      </Alert>
      <ul className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Card padding="lg" className="flex h-full flex-col gap-3" data-restaurant={r.slug}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{r.name}</p>
                  <p className="truncate text-sm text-muted">
                    {r.slug}
                    {r.city ? ` · ${r.city}` : ""}
                  </p>
                </div>
                {r.account?.isActive ? (
                  <Badge tone="ready" icon={<CheckCircle2 />}>Connected</Badge>
                ) : (
                  <Badge tone="neutral" icon={<XCircle />}>Not connected</Badge>
                )}
              </div>
              {r.account ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">Number</dt>
                  <dd className="font-semibold">{r.account.displayPhoneNumber}</dd>
                  <dt className="text-muted">Phone number ID</dt>
                  <dd className="font-mono break-all">{r.account.phoneNumberId}</dd>
                  <dt className="text-muted">Orders go to</dt>
                  <dd>{r.branches.find((b) => b.id === r.account!.branchId)?.name ?? "First branch"}</dd>
                  <dt className="text-muted">Connected</dt>
                  <dd>{formatDateTime(r.account.connectedAt)}</dd>
                </dl>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-2">
                <Button variant={r.account ? "secondary" : "primary"} onClick={() => setEditing(r)}>
                  <PlugZap aria-hidden /> {r.account ? "Edit connection" : "Connect WhatsApp"}
                </Button>
                {r.account ? (
                  <Button variant="danger-outline" onClick={() => setDisconnecting(r)}>
                    <Unplug aria-hidden /> Disconnect
                  </Button>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {editing ? <ConnectModal row={editing} onClose={() => setEditing(null)} /> : null}
      {disconnecting ? <DisconnectModal row={disconnecting} onClose={() => setDisconnecting(null)} /> : null}
    </>
  );
}

function ConnectModal({ row, onClose }: { row: AdminRestaurantRow; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [phoneNumberId, setPhoneNumberId] = useState(row.account?.phoneNumberId ?? "");
  const [wabaId, setWabaId] = useState(row.account?.wabaId ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, startTesting] = useTransition();
  const { pending, onSubmit, fieldError, formError } = useFormAction<{ warning?: string }>(async (prev, formData) => {
    const result = await connectWhatsAppAction(prev, formData);
    if (result.ok) {
      toast({ tone: "success", title: result.message ?? "Saved" });
      if (result.data?.warning) toast({ tone: "error", title: result.data.warning });
      router.refresh();
      onClose();
    }
    return result;
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={<PlugZap />}
      title={row.account ? `Edit WhatsApp · ${row.name}` : `Connect WhatsApp · ${row.name}`}
      description="Copy these from Meta → WhatsApp → API Setup."
    >
      <form id="wa-connect" onSubmit={onSubmit} className="flex flex-col gap-4">
        <input type="hidden" name="restaurantId" value={row.id} />
        {formError ? <Alert>{formError}</Alert> : null}
        <Select
          name="branchId"
          label="Branch for WhatsApp orders"
          required
          defaultValue={row.account?.branchId ?? row.branches[0]?.id ?? ""}
          options={row.branches.map((b) => ({ value: b.id, label: b.name }))}
          error={fieldError("branchId")}
        />
        <Input
          name="phoneNumberId"
          label="Phone number ID"
          inputMode="numeric"
          required
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          error={fieldError("phoneNumberId")}
        />
        <Input
          name="wabaId"
          label="WhatsApp Business Account ID"
          inputMode="numeric"
          required
          value={wabaId}
          onChange={(e) => setWabaId(e.target.value)}
          error={fieldError("wabaId")}
        />
        <Input
          name="displayPhoneNumber"
          label="WhatsApp number (as customers see it)"
          inputMode="tel"
          required
          placeholder="+92 300 1234567"
          defaultValue={row.account?.displayPhoneNumber ?? ""}
          error={fieldError("displayPhoneNumber")}
        />
        <PasswordInput
          name="accessToken"
          label="Access token"
          autoComplete="off"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          required={!row.account}
          hint={
            row.account
              ? "Leave empty to keep the saved token. It is stored encrypted and never shown again."
              : "Use a permanent System User token. It is stored encrypted and never shown again."
          }
          error={fieldError("accessToken")}
        />
        {testResult ? (
          <Alert tone={testResult.ok ? "success" : "error"}>{testResult.text}</Alert>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={testing}
            onClick={() =>
              startTesting(async () => {
                const res = await testWhatsAppConnectionAction({ restaurantId: row.id, phoneNumberId, wabaId, accessToken });
                setTestResult({ ok: res.ok, text: res.ok ? (res.message ?? "Connection works.") : res.error });
              })
            }
          >
            Test connection
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DisconnectModal({ row, onClose }: { row: AdminRestaurantRow; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Modal
      open
      onClose={onClose}
      tone="danger"
      icon={<Unplug />}
      title={`Disconnect ${row.name}?`}
      description="New WhatsApp messages to this number will be ignored and the saved token is deleted. Old chats stay."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep connected
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() =>
              start(async () => {
                const res = await disconnectWhatsAppAction(row.id);
                if (!res.ok) return setError(res.error);
                toast({ tone: "success", title: res.message ?? "Disconnected" });
                router.refresh();
                onClose();
              })
            }
          >
            Disconnect
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
    </Modal>
  );
}
