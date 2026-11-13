import Link from "next/link";
import { ChevronRight, Circle, CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Checklist } from "@/lib/onboarding/checklist";
import { cn } from "@/lib/utils";

/** Onboarding checklist (owner /settings/setup and super admin restaurant page). */
export function ChecklistCard({ checklist, linkSteps = true }: { checklist: Checklist; linkSteps?: boolean }) {
  return (
    <Card padding="lg" className="flex max-w-2xl flex-col gap-4" data-testid="setup-checklist">
      <div>
        <h2 className="text-lg font-bold">Getting ready to take orders</h2>
        <p className="text-sm text-muted">
          {checklist.done} of {checklist.total} done{checklist.complete ? " — all set! 🎉" : ". Each step ticks itself when it's done."}
        </p>
        <span className="mt-2 block h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
          <span className="block h-full rounded-full bg-brand-700" style={{ width: `${(checklist.done / checklist.total) * 100}%` }} />
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {checklist.steps.map((s) => {
          const body = (
            <>
              {s.done ? <CircleCheck aria-hidden className="size-6 shrink-0 text-status-ready-fg" /> : <Circle aria-hidden className="size-6 shrink-0 text-line-strong" />}
              <span className="min-w-0 flex-1">
                <span className={cn("font-semibold", s.done && "text-muted line-through")}>{s.label}</span>
                <span className="block text-sm text-muted">{s.hint}</span>
              </span>
              {linkSteps && !s.done ? <ChevronRight aria-hidden className="size-5 text-muted" /> : null}
              <span className="sr-only">{s.done ? "Done" : "Not done yet"}</span>
            </>
          );
          return (
            <li key={s.key}>
              {linkSteps && !s.done ? (
                <Link href={s.href} className="flex min-h-touch items-center gap-3 py-3 hover:bg-subtle">
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-touch items-center gap-3 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
