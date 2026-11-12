"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleCheck, CircleOff, Clock, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { WEEKDAY_NAMES, type OfferState } from "@/lib/bot/knowledge";
import { deleteOfferAction, saveOfferAction, setOfferActiveAction } from "@/lib/bot/knowledge-actions";
import type { OfferRow, PickerItem } from "@/lib/bot/knowledge-queries";
import { cn } from "@/lib/utils";
import { branchOptions, type BranchOption } from "./bot-knowledge";

const STATE: Record<OfferState, { label: string; tone: BadgeTone; icon: React.ReactNode }> = {
  active: { label: "Active now", tone: "ready", icon: <CircleCheck /> },
  scheduled: { label: "Scheduled", tone: "accepted", icon: <CalendarClock /> },
  expired: { label: "Expired", tone: "delivered", icon: <Clock /> },
  off: { label: "Off", tone: "cancelled", icon: <CircleOff /> },
};

type Draft = {
  id: string | null;
  title: string;
  titleUr: string;
  description: string;
  menuItemId: string;
  branchId: string;
  startDate: string;
  endDate: string;
  daysOfWeek: number[];
  allDay: boolean;
  startTime: string;
  endTime: string;
  isActive: boolean;
};

/** "2026-11-11T19:00:00Z" → "2026-11-12": the restaurant's calendar day (offers start at local midnight). */
function dayOf(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
/** ends_at = start of the day AFTER the last day. */
function endDayOf(iso: string | null, timeZone: string) {
  return iso ? dayOf(new Date(Date.parse(iso) - 1).toISOString(), timeZone) : "";
}

export function OffersTab({
  offers,
  items,
  branches,
  isRestaurantWide,
  today,
  timezone,
  dealsCategoryId,
}: {
  timezone: string;
  offers: OfferRow[];
  items: PickerItem[];
  branches: BranchOption[];
  isRestaurantWide: boolean;
  today: string;
  dealsCategoryId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const options = branchOptions(branches, isRestaurantWide);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OfferRow | null>(null);
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");

  const newDraft = (): Draft => ({
    id: null,
    title: "",
    titleUr: "",
    description: "",
    menuItemId: "",
    branchId: options[0]?.value ?? "",
    startDate: today,
    endDate: "",
    daysOfWeek: [],
    allDay: true,
    startTime: "12:00",
    endTime: "16:00",
    isActive: true,
  });

  const edit = (o: OfferRow): Draft => ({
    id: o.id,
    title: o.title,
    titleUr: o.titleUr ?? "",
    description: o.description ?? "",
    menuItemId: o.menuItemId,
    branchId: o.branchId ?? "",
    startDate: dayOf(o.startsAt, timezone),
    endDate: endDayOf(o.endsAt, timezone),
    daysOfWeek: o.daysOfWeek ?? [],
    allDay: !o.startTime,
    startTime: o.startTime?.slice(0, 5) ?? "12:00",
    endTime: o.endTime?.slice(0, 5) ?? "16:00",
    isActive: o.isActive,
  });

  const selected = items.find((i) => i.id === draft?.menuItemId) ?? null;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)) : items;
    return list.slice(0, 40);
  }, [items, query]);

  function save() {
    if (!draft) return;
    start(async () => {
      setFormError(null);
      const r = await saveOfferAction({
        id: draft.id,
        title: draft.title,
        titleUr: draft.titleUr,
        description: draft.description,
        menuItemId: draft.menuItemId,
        branchId: draft.branchId || null,
        startDate: draft.startDate,
        endDate: draft.endDate || null,
        daysOfWeek: draft.daysOfWeek,
        allDay: draft.allDay,
        startTime: draft.allDay ? null : draft.startTime,
        endTime: draft.allDay ? null : draft.endTime,
        isActive: draft.isActive,
      });
      if (!r.ok) {
        setFormError(r.error);
        setErrors(r.fieldErrors ?? {});
        return;
      }
      setDraft(null);
      setErrors({});
      toast({ title: r.message ?? "Saved" });
      router.refresh();
    });
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="flex flex-col gap-4">
      <Card padding="lg" className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">Offers and deals</h2>
          <p className="text-sm text-muted">
            The bot only mentions offers listed here, and only while they are active. Every offer is a menu item, so the price
            always comes from your menu. To sell a combo, first create it as a menu item (for example in a “Deals” category).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<Plus />}
            onClick={() => {
              setDraft(newDraft());
              setErrors({});
              setFormError(null);
              setQuery("");
            }}
          >
            Add offer
          </Button>
          <Link
            href={dealsCategoryId ? `/menu/items/new?category=${dealsCategoryId}` : "/menu/items/new"}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Tag aria-hidden /> Create a deal item
          </Link>
        </div>
      </Card>

      {offers.length === 0 ? (
        <EmptyState icon={<Tag />} title="No offers yet" description="When there are no offers, the bot tells customers there are no deals right now." />
      ) : (
        <ul className="flex flex-col gap-2">
          {offers.map((o) => {
            const st = STATE[o.state];
            return (
              <li key={o.id}>
                <Card className="flex flex-col gap-2" data-testid="offer-row">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{o.title}</p>
                      {o.titleUr ? (
                        <p dir="rtl" className="font-urdu text-sm leading-loose">
                          {o.titleUr}
                        </p>
                      ) : null}
                      <p className="text-sm text-muted">
                        {o.itemName ?? "Item removed"} · <strong className="text-ink">{o.price ?? "—"}</strong>
                      </p>
                      <p className="text-xs text-muted">
                        {o.schedule}
                        {o.branchId ? ` · ${branches.find((b) => b.id === o.branchId)?.name ?? "One branch"}` : ""}
                      </p>
                    </div>
                    <Badge tone={st.tone} icon={st.icon}>
                      {st.label}
                    </Badge>
                  </div>
                  {!o.itemAvailable ? (
                    <Alert tone="info">The linked item is sold out, hidden or removed, so the bot won&apos;t mention this offer.</Alert>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Switch
                      checked={o.isActive}
                      disabled={pending}
                      onCheckedChange={(v) =>
                        start(async () => {
                          const r = await setOfferActiveAction(o.id, v);
                          if (!r.ok) toast({ title: r.error, tone: "error" });
                          router.refresh();
                        })
                      }
                      label="On"
                    />
                    <span className="flex-1" />
                    <Button variant="secondary" icon={<Pencil />} onClick={() => (setDraft(edit(o)), setErrors({}), setFormError(null), setQuery(""))}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${o.title}`} onClick={() => setDeleting(o)}>
                      <Trash2 />
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit offer" : "New offer"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={save}>
              Save offer
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="flex flex-col gap-4">
            {formError ? <Alert>{formError}</Alert> : null}
            <Input label="Offer name" required value={draft.title} onChange={(e) => set("title", e.target.value)} error={errors.title} placeholder="Friday Deal" />
            <Input
              label="Name in Urdu (optional)"
              dir="rtl"
              className="font-urdu"
              value={draft.titleUr}
              onChange={(e) => set("titleUr", e.target.value)}
              error={errors.titleUr}
            />
            <Textarea
              label="Short description (optional)"
              rows={2}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              error={errors.description}
              placeholder="2 Zinger burgers + 1.5L Coke"
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Menu item for this offer</legend>
              {selected ? (
                <div className="flex items-center gap-3 rounded-control border border-line bg-subtle p-3" data-testid="offer-item">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{selected.name}</p>
                    <p className="text-sm text-muted">
                      {selected.category} · price from your menu: <strong className="text-ink">{selected.price ?? "—"}</strong>
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => set("menuItemId", "")}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    aria-label="Search menu items"
                    placeholder="Search your menu…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    error={errors.menuItemId}
                  />
                  <ul className="flex max-h-56 flex-col overflow-y-auto rounded-control border border-line">
                    {matches.map((i) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          onClick={() => set("menuItemId", i.id)}
                          className="flex min-h-touch w-full items-center gap-2 border-b border-line px-3 text-left text-sm last:border-0 hover:bg-subtle"
                        >
                          <span className="flex-1">
                            {i.name} <span className="text-muted">· {i.category}</span>
                          </span>
                          <span className="font-semibold">{i.price}</span>
                        </button>
                      </li>
                    ))}
                    {!matches.length ? <li className="p-3 text-sm text-muted">No items found.</li> : null}
                  </ul>
                  <Link
                    href={dealsCategoryId ? `/menu/items/new?category=${dealsCategoryId}` : "/menu/items/new"}
                    className="text-sm font-semibold text-brand-700 underline"
                  >
                    Not on the menu yet? Create a deal item
                  </Link>
                </>
              )}
            </fieldset>

            {options.length > 1 ? (
              <Select label="Branch" options={options} value={draft.branchId} onChange={(e) => set("branchId", e.target.value)} />
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Input label="Starts" type="date" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} error={errors.startDate} />
              <Input
                label="Ends (optional)"
                type="date"
                value={draft.endDate}
                min={draft.startDate}
                onChange={(e) => set("endDate", e.target.value)}
                error={errors.endDate}
              />
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Days (none = every day)</legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_NAMES.map((name, i) => {
                  const day = i + 1;
                  const on = draft.daysOfWeek.includes(day);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("daysOfWeek", on ? draft.daysOfWeek.filter((d) => d !== day) : [...draft.daysOfWeek, day])}
                      className={cn(
                        "min-h-touch min-w-touch rounded-control border px-3 text-sm font-semibold",
                        on ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-surface text-muted",
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <Switch checked={draft.allDay} onCheckedChange={(v) => set("allDay", v)} label="All day" />
            {!draft.allDay ? (
              <div className="grid grid-cols-2 gap-3">
                <Input label="From" type="time" value={draft.startTime} onChange={(e) => set("startTime", e.target.value)} error={errors.startTime} />
                <Input label="To" type="time" value={draft.endTime} onChange={(e) => set("endTime", e.target.value)} error={errors.endTime} />
              </div>
            ) : null}
            <Switch checked={draft.isActive} onCheckedChange={(v) => set("isActive", v)} tone="success" label="Offer is on" />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        tone="danger"
        icon={<Trash2 />}
        title={`Delete “${deleting?.title ?? ""}”?`}
        description="The bot stops mentioning it. The menu item stays on your menu."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                const o = deleting!;
                setDeleting(null);
                start(async () => {
                  const r = await deleteOfferAction(o.id);
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
