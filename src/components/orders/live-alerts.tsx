"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Check, RefreshCw, TriangleAlert, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { transitionOrderAction } from "@/lib/orders/actions";
import { formatPKR } from "@/lib/money";
import { minutesSince } from "@/lib/time";
import { useOrdersLive } from "./live-provider";

/**
 * Shown under the top bar on every dashboard page:
 * the "Enable sound" prompt, the red urgent banner, and a realtime-down note.
 */
export function LiveAlerts() {
  const router = useRouter();
  const { toast } = useToast();
  const { urgent, sound, realtime, online, now, refresh } = useOrdersLive();
  const [pending, startTransition] = useTransition();
  const [hidePrompt, setHidePrompt] = useState(false);
  const oldest = urgent[0];

  function accept() {
    if (!oldest) return;
    startTransition(async () => {
      const result = await transitionOrderAction({ orderId: oldest.id, expectedVersion: oldest.version, path: ["accepted"] });
      if (!result.ok) toast({ title: result.message, tone: "error" });
      else toast({ title: `Order #${oldest.orderNumber} accepted` });
      await refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 empty:hidden">
      {oldest ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-panel border-2 border-urgent bg-status-awaiting-bg/80 p-4 sm:flex-row sm:items-center"
        >
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-urgent text-white">
            <TriangleAlert className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-status-awaiting-fg">
              Order #{oldest.orderNumber} waiting {minutesSince(oldest.createdAt, now)} min — accept now!
              {urgent.length > 1 ? <span className="font-semibold"> (+{urgent.length - 1} more)</span> : null}
            </p>
            <p className="truncate text-status-awaiting-fg">
              {oldest.customerName ?? "Customer"} · {oldest.itemSummary} · {formatPKR(oldest.total)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push(`/orders?order=${oldest.id}`, { scroll: false })}>
              View order
            </Button>
            <Button icon={<Check />} loading={pending} disabled={!online || oldest.isOnHold} onClick={accept}>
              Accept #{oldest.orderNumber}
            </Button>
          </div>
        </div>
      ) : null}

      {(!sound.enabled || sound.needsTap) && !hidePrompt ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-2 text-sm">
          <BellRing aria-hidden className="size-5 text-brand-700" />
          <p className="min-w-0 flex-1 basis-48">
            {sound.needsTap ? "Tap here so new-order sounds can play." : "Turn on sound so you never miss a new order."}
          </p>
          <Button size="md" icon={<Volume2 />} onClick={() => void sound.enable()}>
            Enable sound 🔔
          </Button>
          {!sound.enabled ? (
            <Button variant="ghost" size="icon" aria-label="Not now" onClick={() => setHidePrompt(true)}>
              <VolumeX />
            </Button>
          ) : null}
        </div>
      ) : null}

      {realtime === "polling" && online ? (
        <div className="flex items-center gap-2 rounded-card bg-subtle px-4 py-2 text-sm text-muted">
          <RefreshCw aria-hidden className="size-4" />
          Live updates are slow right now. We check for new orders every 20 seconds.
        </div>
      ) : null}
    </div>
  );
}

/** Top bar quick stats, live. */
export function LiveStats() {
  const { snapshot } = useOrdersLive();
  const { stats } = snapshot;
  const tile = "min-w-0 rounded-card px-3 py-2 lg:px-4";
  return (
    <div className="grid grid-cols-3 gap-2 lg:flex lg:gap-3">
      <div className={`${tile} bg-subtle`}>
        <p className="truncate text-xs font-medium text-muted lg:text-sm" title="Delivered or completed orders today (same as Reports)">
          Done today
        </p>
        <p className="truncate text-xl font-bold lg:text-2xl">{stats.ordersToday}</p>
      </div>
      <div className={`${tile} bg-subtle`}>
        <p className="truncate text-xs font-medium text-muted lg:text-sm">Sales today</p>
        <p className="truncate text-xl font-bold lg:text-2xl">{formatPKR(stats.salesToday)}</p>
      </div>
      <div className={`${tile} border border-status-awaiting-border bg-status-awaiting-bg/70`}>
        <p className="flex items-center gap-1.5 truncate text-xs font-medium text-status-awaiting-fg lg:text-sm">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-urgent" />
          Pending
        </p>
        <p className="truncate text-xl font-bold text-status-awaiting-fg lg:text-2xl">{stats.pending}</p>
      </div>
    </div>
  );
}

/** Small sound on/off control for the orders header. */
export function SoundToggle() {
  const { sound } = useOrdersLive();
  return sound.enabled ? (
    <Button variant="secondary" size="icon" aria-label="Turn off new-order sound" onClick={sound.disable}>
      <Volume2 />
    </Button>
  ) : (
    <Button variant="secondary" size="icon" aria-label="Turn on new-order sound" onClick={() => void sound.enable()}>
      <VolumeX />
    </Button>
  );
}
