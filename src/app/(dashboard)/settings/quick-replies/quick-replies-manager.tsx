"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { DragHandle, SortableList } from "@/components/ui/sortable-list";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { InboxSettings } from "@/lib/inbox/queries";
import type { QuickReply } from "@/lib/inbox/rules";
import { deleteQuickReplyAction, reorderQuickRepliesAction, saveInboxTimingsAction, saveQuickReplyAction } from "@/lib/inbox/settings-actions";

export function QuickRepliesManager({ replies, settings, canEditTimings }: { replies: QuickReply[]; settings: InboxSettings; canEditTimings: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState(replies);
  const [synced, setSynced] = useState(replies);
  if (synced !== replies) {
    setSynced(replies);
    setRows(replies);
  }
  const [editing, setEditing] = useState<QuickReply | "new" | null>(null);
  const [deleting, setDeleting] = useState<QuickReply | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card padding="lg" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Zap aria-hidden className="size-5" /> Quick replies
            </h2>
            <p className="text-sm text-muted">In the inbox, type “/” (like /time) to insert one of these. Write them in Roman Urdu + English.</p>
          </div>
          <Button icon={<Plus />} onClick={() => setEditing("new")}>
            Add
          </Button>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Zap />} title="No quick replies" description="Add short answers you send often." />
        ) : (
          <SortableList
            id="quick-replies"
            items={rows}
            onReorder={(next) => {
              setRows(next);
              start(async () => {
                const r = await reorderQuickRepliesAction(next.map((x) => x.id));
                if (!r.ok) {
                  toast({ title: r.error, tone: "error" });
                  setRows(replies);
                }
              });
            }}
            className="flex flex-col gap-2"
          >
            {(r, { handle }) => (
              <div className="flex items-start gap-2 rounded-card border border-line p-2" data-testid="quick-reply-row">
                <DragHandle handle={handle} label={`Move ${r.shortcut}`} />
                <div className="min-w-0 flex-1 py-1">
                  <p className="font-bold text-brand-700">{r.shortcut}</p>
                  <p className="line-clamp-2 text-sm">{r.text}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Edit ${r.shortcut}`} onClick={() => setEditing(r)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${r.shortcut}`} onClick={() => setDeleting(r)}>
                  <Trash2 />
                </Button>
              </div>
            )}
          </SortableList>
        )}
      </Card>

      <Timings settings={settings} canEdit={canEditTimings} />

      {editing ? <ReplyDialog reply={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => router.refresh()} /> : null}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        tone="danger"
        icon={<Trash2 />}
        title={`Delete ${deleting?.shortcut ?? ""}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                const r = deleting!;
                setDeleting(null);
                start(async () => {
                  const res = await deleteQuickReplyAction(r.id);
                  toast(res.ok ? { title: "Deleted" } : { title: res.error, tone: "error" });
                  router.refresh();
                });
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

function ReplyDialog({ reply, onClose, onSaved }: { reply: QuickReply | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? "/");
  const [text, setText] = useState(reply?.text ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Modal
      open
      onClose={onClose}
      title={reply ? `Edit ${reply.shortcut}` : "New quick reply"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await saveQuickReplyAction({ id: reply?.id ?? null, shortcut, text });
                if (!r.ok) {
                  setError(r.error);
                  setErrors(r.fieldErrors ?? {});
                  return;
                }
                toast({ title: "Saved" });
                onClose();
                onSaved();
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Input label="Shortcut" value={shortcut} onChange={(e) => setShortcut(e.target.value)} error={errors.shortcut} placeholder="/time" />
        <Textarea label="Reply" rows={4} value={text} onChange={(e) => setText(e.target.value)} error={errors.text} placeholder="Aap ka order 30–40 minute mein pohanch jayega. Your order will arrive in 30–40 minutes." />
      </div>
    </Modal>
  );
}

function Timings({ settings, canEdit }: { settings: InboxSettings; canEdit: boolean }) {
  const { toast } = useToast();
  const [hours, setHours] = useState(String(settings.autoResolveHours));
  const [minutes, setMinutes] = useState(String(settings.needsStaffAlertMinutes));
  const [pending, start] = useTransition();
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Inbox timings</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Auto-resolve after (hours)"
          inputMode="numeric"
          value={hours}
          disabled={!canEdit}
          onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))}
          hint="A chat staff took over, with no messages for this long, goes back to the bot."
        />
        <Input
          label="“Needs staff” turns red after (minutes)"
          inputMode="numeric"
          value={minutes}
          disabled={!canEdit}
          onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      {canEdit ? (
        <div>
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await saveInboxTimingsAction({ autoResolveHours: Number(hours), needsStaffAlertMinutes: Number(minutes) });
                toast(r.ok ? { title: "Saved" } : { title: r.error, tone: "error" });
              })
            }
          >
            Save timings
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Only the owner can change these.</p>
      )}
    </Card>
  );
}
