"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Banknote, Bike, CheckCircle2, LogOut, MapPin, Navigation, Package, Phone, ShoppingBag, Volume2, WifiOff, XCircle } from "lucide-react";
import { playChime, setSoundPreference, soundPreference, unlockAudio } from "@/components/orders/alert-sound";
import { formatPKR, parseRupees } from "@/lib/money";
import { useLiveRefresh, useWakeLock } from "@/lib/realtime/use-live-refresh";
import { RIDER_FAIL_REASONS } from "@/lib/riders/core";
import { deliveredAction, deliveryFailedAction, pickedUpAction, setOnlineAction } from "@/lib/riders/actions";
import { fetchRiderHomeAction } from "@/lib/riders/home-action";
import { riderLogoutAction } from "@/lib/riders/login";
import type { RiderHome, RiderOrder } from "@/lib/riders/queries";
import { formatPhone } from "@/lib/orders/phone";

/**
 * The rider's phone screen (Phase 9). Big text, icons and colours; a few
 * Urdu words under the main buttons. Live: realtime on the rider's own
 * orders + polling, a chime and vibration when a new order arrives.
 */
const noopSubscribe = () => () => {};

export function RiderScreen({ initial }: { initial: RiderHome }) {
  const [home, setHome] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(initial.rider.isOnline);
  const storedSound = useSyncExternalStore(noopSubscribe, soundPreference, () => false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const sound = storedSound || soundEnabled;
  const [pending, start] = useTransition();
  const seen = useRef(new Set(initial.active.map((o) => o.id)));
  useWakeLock(true);

  async function refresh() {
    const next = await fetchRiderHomeAction().catch(() => null);
    if (!next) return;
    const fresh = next.active.filter((o) => !seen.current.has(o.id));
    next.active.forEach((o) => seen.current.add(o.id));
    if (fresh.length) {
      if (soundPreference()) playChime(true);
      navigator.vibrate?.([300, 150, 300]);
    }
    setHome(next);
  }
  const { online: connected, realtime } = useLiveRefresh({ table: "orders", filter: `rider_id=eq.${initial.rider.id}`, refresh });

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.message ?? r.error ?? "Something went wrong. Try again.");
      await refresh();
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-page pb-32 text-ink" data-testid="rider-screen">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-status-delivery-bg text-status-delivery-fg">
          <Bike aria-hidden className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-bold">{home.rider.name}</p>
          <p className="truncate text-sm text-muted">
            {home.rider.restaurantName} · {home.rider.branchName}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={online}
          data-testid="online-toggle"
          disabled={pending}
          onClick={() => {
            const next = !online;
            setOnline(next);
            run(async () => {
              const r = await setOnlineAction(next);
              if (!r.ok) setOnline(!next);
              return r;
            });
          }}
          className={`flex h-14 shrink-0 items-center gap-2 rounded-full border-2 px-3 text-lg font-bold ${online ? "border-whatsapp bg-status-ready-bg text-status-ready-fg" : "border-line-strong bg-subtle text-muted"}`}
        >
          <span className={`flex h-8 w-14 items-center rounded-full p-1 ${online ? "justify-end bg-whatsapp" : "justify-start bg-line-strong"}`}>
            <span className="size-6 rounded-full bg-white" />
          </span>
          {online ? "ONLINE" : "OFFLINE"}
        </button>
      </header>

      {!connected ? (
        <p className="flex items-center gap-2 bg-status-awaiting-bg px-4 py-2 text-sm font-semibold text-status-awaiting-fg" role="status">
          <WifiOff aria-hidden className="size-4" /> No internet — showing the last orders. We&apos;ll update when you&apos;re back.
        </p>
      ) : null}

      <div className="flex items-center gap-2 px-4 pt-4">
        <h1 className="text-xl font-bold">My orders</h1>
        <span className="flex size-8 items-center justify-center rounded-full bg-ink text-sm font-bold text-white" data-testid="order-count">
          {home.active.length}
        </span>
        <span className="flex-1" />
        {!sound ? (
          <button
            type="button"
            onClick={async () => {
              if (await unlockAudio()) {
                setSoundPreference(true);
                setSoundEnabled(true);
                playChime();
              }
            }}
            className="flex min-h-touch items-center gap-1 rounded-full border border-line-strong bg-surface px-3 text-sm font-semibold"
          >
            <Volume2 aria-hidden className="size-4" /> Sound on
          </button>
        ) : null}
        {realtime !== "live" && connected ? <span className="text-xs text-muted">updating…</span> : null}
      </div>

      {error ? (
        <p role="alert" className="mx-4 mt-3 rounded-card bg-status-cancelled-bg p-3 font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 p-4">
        {home.active.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-8 text-center" data-testid="no-orders">
            <Package aria-hidden className="size-12 text-muted" />
            <p className="text-lg font-bold">No orders right now</p>
            <p className="text-muted">{online ? "New orders will ring here." : "Go ONLINE to get orders."}</p>
          </div>
        ) : (
          home.active.map((o) => <OrderCard key={o.id} order={o} pending={pending} run={run} />)
        )}

        {home.doneToday.length ? (
          <details className="rounded-card border border-line bg-surface p-3">
            <summary className="min-h-touch cursor-pointer content-center font-semibold">Done today ({home.doneToday.length})</summary>
            <ul className="mt-2 divide-y divide-line">
              {home.doneToday.map((o) => (
                <li key={o.id} className="flex items-center gap-2 py-2">
                  {o.status === "failed" ? <XCircle aria-hidden className="size-5 text-danger" /> : <CheckCircle2 aria-hidden className="size-5 text-whatsapp" />}
                  <span className="font-semibold">#{o.orderNumber}</span>
                  <span className="flex-1 truncate">{o.customerName}</span>
                  <span className="font-semibold">{o.codCollectedAmount != null ? formatPKR(o.codCollectedAmount) : o.status === "failed" ? "Failed" : "Paid"}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <form action={riderLogoutAction} className="pt-4 text-center">
          <button type="submit" className="inline-flex min-h-touch items-center gap-2 px-4 text-muted underline">
            <LogOut aria-hidden className="size-4" /> Log out
          </button>
        </form>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-lg grid-cols-2 gap-3 bg-ink p-3 text-white" data-testid="rider-summary">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-card bg-white/10">
            <Bike aria-hidden className="size-6 text-status-delivery-border" />
          </span>
          <div>
            <p className="text-sm text-white/70">Today</p>
            <p className="text-xl font-bold">
              {home.deliveriesToday} <span className="text-base font-semibold">{home.deliveriesToday === 1 ? "delivery" : "deliveries"}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-card bg-white/10">
            <Banknote aria-hidden className="size-6 text-urgent" />
          </span>
          <div>
            <p className="text-sm text-white/70">Cash in hand</p>
            <p className="text-xl font-bold" data-testid="cash-in-hand">
              {formatPKR(home.cashInHand)}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => void;

function OrderCard({ order: o, pending, run }: { order: RiderOrder; pending: boolean; run: Run }) {
  const onTheWay = o.status === "out_for_delivery";
  const [step, setStep] = useState<"none" | "cash" | "other-amount" | "failed">("none");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [failReason, setFailReason] = useState("");
  const [failNote, setFailNote] = useState("");

  return (
    <article
      className={`overflow-hidden rounded-panel border-2 bg-surface ${onTheWay ? "border-status-delivery-border" : "border-line"}`}
      data-testid="rider-order"
      data-order={o.orderNumber}
    >
      <div className={`flex items-center gap-2 px-4 py-3 ${onTheWay ? "bg-status-delivery-bg text-status-delivery-fg" : "bg-status-ready-bg text-status-ready-fg"}`}>
        {onTheWay ? <Bike aria-hidden className="size-6" /> : <Package aria-hidden className="size-6" />}
        <span className="flex-1 text-lg font-bold">{onTheWay ? "On the way" : "Food ready — pick up"}</span>
        <span className="text-2xl font-bold text-ink">#{o.orderNumber}</span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <p className="text-2xl font-bold">{o.customerName ?? "Customer"}</p>
          {o.area ? (
            <p className="flex items-center gap-1 text-lg font-bold text-brand-700">
              <MapPin aria-hidden className="size-5" /> {o.area}
            </p>
          ) : null}
          <p className="text-lg">{[o.addressText, o.landmark].filter(Boolean).join(", ")}</p>
          <p className="text-sm text-muted">
            {o.itemCount} items · {o.items.join(", ")}
          </p>
          {o.notes ? <p className="mt-1 rounded-control bg-status-awaiting-bg p-2 font-semibold text-status-awaiting-fg">📝 {o.notes}</p> : null}
        </div>

        {o.paid ? (
          <div className="flex items-center gap-3 rounded-card border-2 border-status-ready-border bg-status-ready-bg p-3" data-testid="paid">
            <CheckCircle2 aria-hidden className="size-10 text-whatsapp" />
            <p className="text-3xl font-bold text-status-ready-fg">PAID · Don&apos;t collect</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-card border-2 border-urgent bg-status-awaiting-bg p-3" data-testid="collect">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-card bg-urgent">
              <Banknote aria-hidden className="size-8 text-ink" />
            </span>
            <div>
              <p className="font-semibold text-status-awaiting-fg">Collect cash · کیش لیں</p>
              <p className="text-4xl font-bold">{formatPKR(o.toCollect)}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {o.customerPhone ? (
            <a
              href={`tel:${o.customerPhone}`}
              className="flex h-16 items-center justify-center gap-2 rounded-card border-2 border-whatsapp bg-status-ready-bg text-xl font-bold text-status-ready-fg"
              aria-label={`Call ${formatPhone(o.customerPhone)}`}
            >
              <Phone aria-hidden className="size-6" /> Call
            </a>
          ) : (
            <span />
          )}
          {o.mapsUrl ? (
            <a
              href={o.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-16 items-center justify-center gap-2 rounded-card border-2 border-status-accepted-border bg-status-accepted-bg text-xl font-bold text-status-accepted-fg"
            >
              <Navigation aria-hidden className="size-6" /> Map
            </a>
          ) : null}
        </div>

        {step === "none" ? (
          onTheWay ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => (o.paid ? run(() => deliveredAction({ orderId: o.id, expectedVersion: o.version, amount: null })) : setStep("cash"))}
                className="flex h-20 flex-col items-center justify-center rounded-card bg-whatsapp text-white disabled:opacity-60"
              >
                <span className="flex items-center gap-3 text-3xl font-bold">
                  <CheckCircle2 aria-hidden className="size-9" /> Delivered
                </span>
                <span className="text-sm">پہنچا دیا</span>
              </button>
              <button type="button" onClick={() => setStep("failed")} className="min-h-touch font-semibold text-danger underline">
                Delivery failed?
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => pickedUpAction({ orderId: o.id, expectedVersion: o.version }))}
              className="flex h-20 flex-col items-center justify-center rounded-card bg-brand-700 text-white disabled:opacity-60"
            >
              <span className="flex items-center gap-3 text-3xl font-bold">
                <ShoppingBag aria-hidden className="size-9" /> Picked up
              </span>
              <span className="text-sm">کھانا لے لیا</span>
            </button>
          )
        ) : null}

        {step === "cash" ? (
          <div className="flex flex-col gap-3 rounded-card border-2 border-whatsapp p-3" data-testid="cash-confirm">
            <p className="text-xl font-bold">Cash collected {formatPKR(o.toCollect)}?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deliveredAction({ orderId: o.id, expectedVersion: o.version, amount: o.toCollect }))}
                className="h-16 rounded-card bg-whatsapp text-2xl font-bold text-white"
              >
                Yes ✓
              </button>
              <button type="button" onClick={() => setStep("other-amount")} className="h-16 rounded-card border-2 border-line-strong text-lg font-bold">
                Different amount
              </button>
            </div>
            <button type="button" onClick={() => setStep("none")} className="min-h-touch text-muted underline">
              Back
            </button>
          </div>
        ) : null}

        {step === "other-amount" ? (
          <div className="flex flex-col gap-3 rounded-card border-2 border-urgent p-3">
            <label className="flex flex-col gap-1 text-lg font-bold">
              Cash you got (Rs)
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                className="h-14 rounded-control border-2 border-line-strong px-3 text-2xl"
                aria-label="Cash collected in rupees"
              />
            </label>
            <label className="flex flex-col gap-1 font-bold">
              Why different?
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="h-14 rounded-control border-2 border-line-strong px-3 text-lg" placeholder="e.g. customer had no change" />
            </label>
            <button
              type="button"
              disabled={pending || !amount || !reason.trim()}
              onClick={() => {
                const paisa = parseRupees(amount);
                if (paisa === null) return;
                run(() => deliveredAction({ orderId: o.id, expectedVersion: o.version, amount: paisa, reason }));
              }}
              className="h-16 rounded-card bg-whatsapp text-2xl font-bold text-white disabled:opacity-50"
            >
              Save · Delivered
            </button>
            <button type="button" onClick={() => setStep("cash")} className="min-h-touch text-muted underline">
              Back
            </button>
          </div>
        ) : null}

        {step === "failed" ? (
          <div className="flex flex-col gap-2 rounded-card border-2 border-status-cancelled-border p-3" data-testid="fail-reasons">
            <p className="text-xl font-bold">Why couldn&apos;t you deliver?</p>
            {RIDER_FAIL_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={failReason === r.value}
                onClick={() => setFailReason(r.value)}
                className={`flex min-h-14 items-center justify-between rounded-card border-2 px-4 text-lg font-semibold ${failReason === r.value ? "border-danger bg-status-cancelled-bg" : "border-line"}`}
              >
                {r.label} <span className="text-sm text-muted">{r.urdu}</span>
              </button>
            ))}
            {failReason === "other" ? (
              <input value={failNote} onChange={(e) => setFailNote(e.target.value)} placeholder="What happened?" className="h-14 rounded-control border-2 border-line-strong px-3 text-lg" />
            ) : null}
            <button
              type="button"
              disabled={pending || !failReason || (failReason === "other" && !failNote.trim())}
              onClick={() => run(() => deliveryFailedAction({ orderId: o.id, expectedVersion: o.version, reason: failReason, note: failNote }))}
              className="h-16 rounded-card bg-danger text-xl font-bold text-white disabled:opacity-50"
            >
              Mark as failed
            </button>
            <button type="button" onClick={() => setStep("none")} className="min-h-touch text-muted underline">
              Back
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
