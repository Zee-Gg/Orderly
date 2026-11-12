"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, Lightbulb, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipInput } from "@/components/ui/chip-input";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { DragHandle, SortableList } from "@/components/ui/sortable-list";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { addFaqSuggestionsAction, deleteFaqAction, reorderFaqsAction, saveFaqAction } from "@/lib/bot/knowledge-actions";
import type { FaqRow } from "@/lib/bot/knowledge-queries";

type Draft = { id: string | null; question: string; answer: string; answerUr: string; keywords: string[]; isActive: boolean };

export function FaqsTab({ faqs }: { faqs: FaqRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState(faqs);
  const [synced, setSynced] = useState(faqs);
  if (synced !== faqs) {
    setSynced(faqs);
    setRows(faqs);
  }
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FaqRow | null>(null);
  const [pending, start] = useTransition();

  const unanswered = rows.filter((f) => !f.answer).length;

  function save() {
    if (!draft) return;
    start(async () => {
      setFormError(null);
      const r = await saveFaqAction({ ...draft, answerUr: draft.answerUr || null });
      if (!r.ok) {
        setFormError(r.error);
        setErrors(r.fieldErrors ?? {});
        return;
      }
      setDraft(null);
      toast({ title: r.message ?? "Saved" });
      router.refresh();
    });
  }

  const open = (f: FaqRow | null) => {
    setErrors({});
    setFormError(null);
    setDraft(
      f
        ? { id: f.id, question: f.question, answer: f.answer, answerUr: f.answerUr ?? "", keywords: f.keywords, isActive: f.isActive || !f.answer }
        : { id: null, question: "", answer: "", answerUr: "", keywords: [], isActive: true },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card padding="lg" className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">Customer questions</h2>
          <p className="text-sm text-muted">
            The bot answers only with what you write here (plus your hours, address, delivery and payment info). If it
            doesn&apos;t know, it says “Main staff se pooch kar batata hoon” and passes the chat to your staff.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Plus />} onClick={() => open(null)}>
            Add question
          </Button>
          <Button
            variant="secondary"
            icon={<Lightbulb />}
            loading={pending && !draft}
            onClick={() =>
              start(async () => {
                const r = await addFaqSuggestionsAction();
                toast(r.ok ? { title: r.message ?? "Added" } : { title: r.error, tone: "error" });
                router.refresh();
              })
            }
          >
            Add common questions
          </Button>
        </div>
        {unanswered ? (
          <Alert tone="info">
            {unanswered === 1 ? "1 question has" : `${unanswered} questions have`} no answer yet. The bot ignores them until you write
            the answer.
          </Alert>
        ) : null}
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={<HelpCircle />}
          title="No questions yet"
          description="Tap “Add common questions” for parking, family hall, birthdays and more — then write your answers."
        />
      ) : (
        <SortableList
          id="faqs"
          items={rows}
          onReorder={(next) => {
            setRows(next);
            start(async () => {
              const r = await reorderFaqsAction(next.map((f) => f.id));
              if (!r.ok) {
                toast({ title: r.error, tone: "error" });
                setRows(faqs);
              }
            });
          }}
          className="flex flex-col gap-2"
        >
          {(f, { handle }) => (
            <Card className="flex items-start gap-2 p-2" data-testid="faq-row">
              <DragHandle handle={handle} label={`Move “${f.question}”`} />
              <div className="min-w-0 flex-1 py-2">
                <p className="font-semibold">{f.question}</p>
                {f.answer ? (
                  <p className="line-clamp-2 text-sm text-muted">{f.answer}</p>
                ) : (
                  <Badge tone="awaiting">No answer yet</Badge>
                )}
                {f.answer && !f.isActive ? <Badge tone="delivered">Off</Badge> : null}
              </div>
              <Button variant="ghost" size="icon" aria-label={`Edit “${f.question}”`} onClick={() => open(f)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Delete “${f.question}”`} onClick={() => setDeleting(f)}>
                <Trash2 />
              </Button>
            </Card>
          )}
        </SortableList>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit question" : "New question"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="flex flex-col gap-4">
            {formError ? <Alert>{formError}</Alert> : null}
            <Input
              label="Question"
              required
              value={draft.question}
              onChange={(e) => setDraft({ ...draft, question: e.target.value })}
              error={errors.question}
              placeholder="Is there parking?"
            />
            <Textarea
              label="Answer"
              rows={3}
              value={draft.answer}
              onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
              error={errors.answer}
              hint="Write it the way you'd tell a customer. The bot replies in the customer's language."
            />
            <Textarea
              label="Answer in Urdu (optional)"
              rows={2}
              dir="rtl"
              className="font-urdu leading-loose"
              value={draft.answerUr}
              onChange={(e) => setDraft({ ...draft, answerUr: e.target.value })}
              error={errors.answerUr}
            />
            <ChipInput
              label="Words customers use (optional)"
              hint="e.g. parking, gari, car. Helps the bot find this answer."
              value={draft.keywords}
              onChange={(keywords) => setDraft({ ...draft, keywords })}
              maxItems={30}
              maxLength={40}
            />
            <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} tone="success" label="Bot uses this answer" />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        tone="danger"
        icon={<Trash2 />}
        title="Delete this question?"
        description={deleting?.question}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                const f = deleting!;
                setDeleting(null);
                start(async () => {
                  const r = await deleteFaqAction(f.id);
                  toast(r.ok ? { title: r.message ?? "Deleted" } : { title: r.error, tone: "error" });
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
