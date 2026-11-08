"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bike, Check, Clock, Flame, LogOut, Moon, PauseCircle, ShoppingBag, Sun, TriangleAlert, UtensilsCrossed, Volume2, VolumeX } from "lucide-react";
import { audioReady, playChime, setSoundPreference, soundPreference, unlockAudio } from "@/components/orders/alert-sound";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { useToast } from "@/components/ui/toast";
import { signOut } from "@/lib/auth/actions";
import { fetchKitchenSnapshotAction } from "@/lib/kitchen/actions";
import { READY_VISIBLE_MS } from "@/lib/kitchen/constants";
import type { KitchenSnapshot, KitchenTicket } from "@/lib/kitchen/queries";
import { transitionOrderAction } from "@/lib/orders/actions";
import type { OrderStatus } from "@/lib/orders/constants";
import { useLiveRefresh, useWakeLock } from "@/lib/realtime/use-live-refresh";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";

const WARN_MINUTES = 15;
const THEME_KEY = "orderly:kitchen-theme";
const ACK_KEY = "orderly:kitchen-ack";

type Theme = "dark" | "light";
type Ack = { cancelled: string[]; edits: number[] };

const palette = {
  dark: {
    page: "bg-stone-950 text-white",
    bar: "border-stone-800 bg-stone-900",
    card: "bg-stone-900 border-stone-700",
    band: "bg-stone-800",
    muted: "text-stone-400",
    pill: "border-stone-700 bg-stone-900 text-white",
    note: "bg-amber-950 text-amber-200",
    extra: "text-orange-400",
    removal: "text-red-400",
  },
  light: {
    page: "bg-stone-100 text-stone-900",
    bar: "border-stone-200 bg-white",
    card: "bg-white border-stone-200",
    band: "bg-stone-100",
    muted: "text-stone-500",
    pill: "border-stone-300 bg-white text-stone-900",
    note: "bg-amber-100 text-amber-900",
    extra: "text-orange-700",
    removal: "text-red-700",
  },
} as const;

function readAck(): Ack {
  try {
    const raw = JSON.parse(window.localStorage.getItem(ACK_KEY) ?? "{}") as Partial<Ack>;
    return { cancelled: raw.cancelled ?? [], edits: raw.edits ?? [] };
  } catch {
    return { cancelled: [], edits: [] };
  }
}

function writeAck(ack: Ack) {
  try {
    window.localStorage.setItem(ACK_KEY, JSON.stringify({ cancelled: ack.cancelled.slice(-200), edits: ack.edits.slice(-200) }));
  } catch {
    // Storage blocked: acknowledgements last for this visit only.
  }
}

/** "26:40" */
function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const TYPE_LABEL = { delivery: "Delivery", pickup: "Pickup", dine_in: "Dine-in" } as const;
const TYPE_ICON = { delivery: Bike, pickup: ShoppingBag, dine_in: UtensilsCrossed } as const;

export function KitchenScreen({
  initial,
  restaurantId,
  branchName,
  timezone,
  canOpenOrders,
}: {
  initial: KitchenSnapshot;
  restaurantId: string;
  branchName: string;
  timezone: string;
  canOpenOrders: boolean;
}) {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [theme, setTheme] = useState<Theme>("dark");
  const [ack, setAck] = useState<Ack>({ cancelled: [], edits: [] });
  const [soundOn, setSoundOn] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const known = useRef(new Set(initial.tickets.filter((t) => t.status === "accepted" || t.status === "preparing").map((t) => t.id)));
  const soundRef = useRef(false);

  // Device preferences (theme, sound, acknowledged alerts) after mount.
  useEffect(() => {
    const pref = soundPreference();
    soundRef.current = pref;
    let storedTheme: Theme = "dark";
    try {
      storedTheme = window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- device-only settings, not available during SSR
    setSoundOn(pref);
    setTheme(storedTheme);
    setAck(readAck());
    if (!pref) return;
    const unlock = () => void unlockAudio().then(setUnlocked);
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useWakeLock();

  const refresh = useCallback(async () => {
    const result = await fetchKitchenSnapshotAction();
    if (!result.ok) return;
    const active = result.data.tickets.filter((t) => t.status === "accepted" || t.status === "preparing");
    const fresh = active.filter((t) => !known.current.has(t.id));
    known.current = new Set(active.map((t) => t.id));
    setSnapshot(result.data);
    if (fresh.length) {
      if (soundRef.current) playChime();
      setHighlighted((prev) => new Set([...prev, ...fresh.map((t) => t.id)]));
      setTimeout(() => {
        setHighlighted((prev) => {
          const next = new Set(prev);
          fresh.forEach((t) => next.delete(t.id));
          return next;
        });
      }, 20_000);
    }
  }, []);

  // Kitchen can't read `orders`, but every order change writes an order event.
  const { online } = useLiveRefresh({ table: "order_events", filter: `restaurant_id=eq.${restaurantId}`, refresh });

  const acknowledge = (patch: Partial<Ack>) => {
    const next = { cancelled: [...ack.cancelled, ...(patch.cancelled ?? [])], edits: [...ack.edits, ...(patch.edits ?? [])] };
    setAck(next);
    writeAck(next);
  };

  async function move(ticket: KitchenTicket, to: OrderStatus) {
    setBusy(ticket.id);
    const result = await transitionOrderAction({ orderId: ticket.id, expectedVersion: ticket.version, path: [to] });
    setBusy(null);
    if (!result.ok) toast({ title: result.message, tone: "error" });
    await refresh();
  }

  const p = palette[theme];
  const { active, ready, cancelled } = useMemo(() => {
    const t = snapshot.tickets;
    return {
      active: t.filter((x) => x.status === "accepted" || x.status === "preparing"),
      ready: t
        .filter((x) => x.status === "ready" && x.readyAt && now - new Date(x.readyAt).getTime() < READY_VISIBLE_MS)
        .sort((a, b) => (a.readyAt ?? "").localeCompare(b.readyAt ?? "")),
      cancelled: t.filter((x) => x.status === "cancelled" && !ack.cancelled.includes(x.id)),
    };
  }, [snapshot, now, ack]);

  return (
    <div className={cn("flex min-h-dvh flex-col", p.page)}>
      {/* Top bar */}
      <header className={cn("flex flex-wrap items-center gap-3 border-b px-4 py-3 lg:px-6", p.bar)}>
        <div className="min-w-0 flex-1 basis-40">
          <h1 className="text-2xl font-bold">Kitchen</h1>
          <p className={cn("truncate", p.muted)}>
            {branchName} · {formatClock(new Date(now).toISOString(), timezone)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Order counts">
          <span className={cn("flex min-h-14 items-center gap-2 rounded-panel border-2 px-4 text-xl font-bold", theme === "dark" ? "border-amber-500 bg-amber-950 text-amber-300" : "border-amber-400 bg-amber-50 text-amber-900")}>
            <span aria-hidden className="size-3 rounded-full bg-amber-500" />
            New <span className="flex size-9 items-center justify-center rounded-full bg-amber-500 text-black">{snapshot.newCount}</span>
          </span>
          <span className={cn("flex min-h-14 items-center gap-2 rounded-panel border-2 px-4 text-xl font-bold", theme === "dark" ? "border-white bg-white text-black" : "border-stone-900 bg-stone-900 text-white")}>
            <Flame aria-hidden className="size-6" />
            Preparing <span className={cn("flex size-9 items-center justify-center rounded-full", theme === "dark" ? "bg-black text-white" : "bg-white text-black")}>{active.length}</span>
          </span>
          <span className={cn("flex min-h-14 items-center gap-2 rounded-panel border-2 px-4 text-xl font-bold", p.pill)}>
            <Check aria-hidden className="size-6" />
            Ready <span className={cn("flex size-9 items-center justify-center rounded-full", theme === "dark" ? "bg-stone-700" : "bg-stone-200")}>{ready.length}</span>
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              if (soundOn) {
                setSoundPreference(false);
                soundRef.current = false;
                setSoundOn(false);
              } else {
                const ok = await unlockAudio();
                setUnlocked(ok);
                setSoundPreference(true);
                soundRef.current = true;
                setSoundOn(true);
                if (ok) playChime();
              }
            }}
            aria-pressed={soundOn}
            aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
            className={cn("flex min-h-14 items-center gap-2 rounded-panel border-2 px-4 text-lg font-bold", p.pill)}
          >
            {soundOn ? <Volume2 aria-hidden className="size-6" /> : <VolumeX aria-hidden className="size-6" />}
            {soundOn ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              try {
                window.localStorage.setItem(THEME_KEY, next);
              } catch {
                // ignore
              }
            }}
            aria-label={theme === "dark" ? "Switch to light screen" : "Switch to dark screen"}
            className={cn("flex size-14 items-center justify-center rounded-panel border-2", p.pill)}
          >
            {theme === "dark" ? <Sun aria-hidden className="size-6" /> : <Moon aria-hidden className="size-6" />}
          </button>
          {canOpenOrders ? (
            <Link href="/orders" aria-label="Back to orders" className={cn("flex size-14 items-center justify-center rounded-panel border-2", p.pill)}>
              <ArrowLeft aria-hidden className="size-6" />
            </Link>
          ) : null}
          <form action={signOut}>
            <button type="submit" aria-label="Log out" className={cn("flex size-14 items-center justify-center rounded-panel border-2", p.pill)}>
              <LogOut aria-hidden className="size-6" />
            </button>
          </form>
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-3 empty:hidden lg:px-6">
        <OfflineBanner />
        {soundOn && !unlocked && !audioReady() ? (
          <button
            type="button"
            onClick={() => void unlockAudio().then((ok) => (setUnlocked(ok), ok && playChime()))}
            className="flex min-h-14 items-center justify-center gap-2 rounded-panel bg-amber-500 px-4 text-lg font-bold text-black"
          >
            <Volume2 aria-hidden className="size-6" /> Tap here to turn on new-order sound
          </button>
        ) : null}
        {cancelled.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => acknowledge({ cancelled: [t.id] })}
            className="flex min-h-20 w-full items-center justify-center gap-3 rounded-panel bg-red-600 px-4 text-3xl font-black text-white shadow-raised"
          >
            <TriangleAlert aria-hidden className="size-9" />
            ORDER #{t.orderNumber} CANCELLED
            <span className="text-lg font-semibold opacity-90">— tap to dismiss</span>
          </button>
        ))}
      </div>

      {/* Tickets */}
      <main className="flex-1 p-4 lg:p-6">
        {active.length === 0 && ready.length === 0 ? (
          <div className={cn("flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-center", p.muted)}>
            <Flame aria-hidden className="size-16" />
            <p className="text-3xl font-bold">No orders to cook</p>
            <p className="text-xl">Accepted orders appear here automatically.</p>
          </div>
        ) : (
          <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {[...active, ...ready].map((t) => {
              const late = snapshot.branches[t.branchId]?.lateOrderMinutes ?? 30;
              const elapsedMs = t.acceptedAt ? now - new Date(t.acceptedAt).getTime() : 0;
              const minutes = elapsedMs / 60000;
              const isReady = t.status === "ready";
              const state = isReady ? "ready" : minutes >= late ? "late" : minutes >= WARN_MINUTES ? "warn" : "normal";
              const changed = !isReady && t.lastEdit && !ack.edits.includes(t.lastEdit.id);
              const TypeIcon = TYPE_ICON[t.orderType];
              return (
                <article
                  key={t.id}
                  aria-label={`Order ${t.orderNumber}`}
                  className={cn(
                    "overflow-hidden rounded-panel border-4",
                    p.card,
                    state === "late" && "border-red-600",
                    state === "warn" && "border-yellow-400",
                    state === "ready" && "border-green-600 opacity-80",
                    changed && "border-yellow-400",
                    highlighted.has(t.id) && "ring-8 ring-amber-400/60",
                  )}
                >
                  <header
                    className={cn(
                      "px-5 py-4",
                      state === "late" && "bg-red-600 text-white",
                      state === "warn" && "bg-yellow-400 text-black",
                      state === "ready" && "bg-green-600 text-white",
                      state === "normal" && p.band,
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-5xl leading-none font-black tracking-tight lg:text-6xl">#{t.orderNumber}</span>
                      {state === "late" ? (
                        <span className="rounded-lg bg-white px-3 py-1 text-xl font-black text-red-600">LATE</span>
                      ) : state === "warn" ? (
                        <Clock aria-label="Getting late" className="size-9" />
                      ) : null}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-2xl font-bold">
                      <span className="flex items-center gap-2">
                        <TypeIcon aria-hidden className="size-7" />
                        {TYPE_LABEL[t.orderType]}
                        {t.orderType === "dine_in" && t.tableNumber ? ` · Table ${t.tableNumber}` : ""}
                      </span>
                      <span className="text-3xl tabular-nums" aria-label={isReady ? "Ready" : "Time since accepted"}>
                        {isReady ? "READY" : clock(elapsedMs)}
                      </span>
                    </div>
                  </header>

                  <div className="flex flex-col gap-4 p-5">
                    {changed ? (
                      <div className="rounded-card border-2 border-yellow-400 bg-yellow-400/15 p-3">
                        <p className="flex items-center gap-2 text-xl font-black text-yellow-500">
                          <TriangleAlert aria-hidden className="size-6" /> CHANGED
                        </p>
                        <p className="text-lg">The order was changed. The items below are the new ones.</p>
                        <button
                          type="button"
                          onClick={() => acknowledge({ edits: [t.lastEdit!.id] })}
                          className="mt-3 min-h-14 w-full rounded-card bg-yellow-400 text-xl font-bold text-black"
                        >
                          OK, got it
                        </button>
                      </div>
                    ) : null}
                    {t.isOnHold ? (
                      <p className="flex items-center gap-2 rounded-card bg-amber-500 p-3 text-xl font-black text-black">
                        <PauseCircle aria-hidden className="size-6" /> ON HOLD{t.holdReason ? ` · ${t.holdReason}` : ""}
                      </p>
                    ) : null}

                    <ul className="flex flex-col gap-4">
                      {t.items.map((i) => (
                        <li key={i.id}>
                          <p className="text-2xl leading-tight font-bold lg:text-3xl">
                            {i.quantity}× {i.name}
                            {i.size ? <span className={cn("font-semibold", p.muted)}> {i.size}</span> : null}
                          </p>
                          {i.extras.map((e) => (
                            <p key={e} className={cn("text-xl font-bold uppercase", p.extra)}>
                              + {e}
                            </p>
                          ))}
                          {i.removals.map((r) => (
                            <p key={r} className={cn("text-xl font-black uppercase", p.removal)}>
                              × NO {r}
                            </p>
                          ))}
                          {i.notes ? <p className={cn("mt-1 rounded-card px-3 py-2 text-xl font-semibold", p.note)}>“{i.notes}”</p> : null}
                        </li>
                      ))}
                    </ul>
                    {t.notes ? <p className={cn("rounded-card px-4 py-3 text-xl font-semibold", p.note)}>“{t.notes}”</p> : null}

                    {t.status === "accepted" ? (
                      <button
                        type="button"
                        disabled={!online || busy === t.id || t.isOnHold}
                        onClick={() => void move(t, "preparing")}
                        className="flex min-h-20 items-center justify-center gap-3 rounded-panel bg-brand-700 text-3xl font-black text-white disabled:opacity-50"
                      >
                        <Flame aria-hidden className="size-8" /> START
                      </button>
                    ) : t.status === "preparing" ? (
                      <button
                        type="button"
                        disabled={!online || busy === t.id || t.isOnHold}
                        onClick={() => void move(t, "ready")}
                        className="flex min-h-20 items-center justify-center gap-3 rounded-panel bg-green-600 text-3xl font-black text-white disabled:opacity-50"
                      >
                        READY ✓
                      </button>
                    ) : (
                      <p className={cn("text-center text-lg font-semibold", p.muted)}>Waiting for pickup</p>
                    )}
                    {!online ? <p className="text-center text-lg font-semibold text-red-500">Offline — buttons will work when the internet is back</p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <footer className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 border-t px-4 py-3 text-lg lg:px-6", p.bar)}>
        <span className="flex items-center gap-2">
          <span aria-hidden className={cn("size-5 rounded border-2", theme === "dark" ? "border-stone-500" : "border-stone-400")} /> Under {WARN_MINUTES} min
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-5 rounded bg-yellow-400" /> {WARN_MINUTES}+ min
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-5 rounded bg-red-600" /> Late
        </span>
        <span className={cn("ml-auto", p.muted)}>Tap READY when food is packed</span>
      </footer>
    </div>
  );
}
