"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { fetchLiveSnapshotAction } from "@/lib/orders/actions";
import type { BoardOrder, LiveSnapshot, NeedsStaffChat } from "@/lib/orders/queries";
import { SOURCE_LABELS } from "@/lib/orders/constants";
import { formatPKR } from "@/lib/money";
import { useLiveRefresh, type RealtimeState } from "@/lib/realtime/use-live-refresh";
import { minutesSince } from "@/lib/time";
import { audioReady, playChime, setSoundPreference, soundPreference, unlockAudio } from "./alert-sound";

export type { RealtimeState };

type LiveContext = {
  snapshot: LiveSnapshot;
  refresh: () => Promise<void>;
  realtime: RealtimeState;
  online: boolean;
  /** Orders that arrived in the last few seconds (card highlight). */
  highlighted: Set<string>;
  /** New orders waiting longer than the branch's accept alert time. */
  urgent: BoardOrder[];
  isLate: (order: BoardOrder) => boolean;
  now: number;
  timezone: string;
  sound: { enabled: boolean; needsTap: boolean; enable: () => Promise<void>; disable: () => void };
};

const Ctx = createContext<LiveContext | null>(null);

export function useOrdersLive() {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useOrdersLive must be used inside <OrdersLiveProvider>");
  return ctx;
}

/** Like useOrdersLive, but null outside the provider (e.g. kitchen screen). */
export function useOrdersLiveOptional() {
  return use(Ctx);
}

const URGENT_REPEAT_MS = 30_000;
const TITLE_PREFIX = /^\(\d+\) New orders? · /;

/**
 * Live orders for the dashboard: realtime subscription (RLS-filtered),
 * catch-up on reconnect, 20s polling while realtime is down, new-order
 * sound/toast/highlight, urgent and late detection, and the tab title.
 */
export function OrdersLiveProvider({
  initial,
  restaurantId,
  branchIds,
  timezone,
  children,
}: {
  initial: LiveSnapshot;
  restaurantId: string;
  branchIds: string[];
  timezone: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState(initial);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [soundOn, setSoundOn] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const known = useRef(new Set(initial.orders.filter((o) => o.status === "awaiting_acceptance").map((o) => o.id)));
  const knownChats = useRef(new Set(initial.needsStaff.map((c) => c.id)));
  const inFlight = useRef<Promise<void> | null>(null);
  const soundOnRef = useRef(false);

  // Server data changes (branch switch, navigation) replace the snapshot.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    if (initial.fetchedAt > snapshot.fetchedAt) setSnapshot(initial);
  }

  const announce = useCallback(
    (fresh: BoardOrder[]) => {
      if (!fresh.length) return;
      if (soundOnRef.current) playChime();
      setHighlighted((prev) => new Set([...prev, ...fresh.map((o) => o.id)]));
      setTimeout(() => {
        setHighlighted((prev) => {
          const next = new Set(prev);
          fresh.forEach((o) => next.delete(o.id));
          return next;
        });
      }, 15_000);
      for (const o of fresh.slice(0, 3)) {
        toast({
          title: `New order #${o.orderNumber}`,
          description: `${o.customerName ?? "Customer"} · ${o.itemCount} item${o.itemCount === 1 ? "" : "s"} · ${formatPKR(o.total)} · via ${SOURCE_LABELS[o.source]}`,
          tone: "info",
          duration: 8000,
          action: { label: "View", onClick: () => router.push(`/orders?order=${o.id}`, { scroll: false }) },
        });
      }
    },
    [router, toast],
  );

  // A WhatsApp chat the bot handed to staff: sound + toast that opens the chat.
  const announceChats = useCallback(
    (fresh: NeedsStaffChat[]) => {
      if (!fresh.length) return;
      if (soundOnRef.current) playChime(true);
      for (const c of fresh.slice(0, 3)) {
        toast({
          title: "Customer needs staff",
          description: `${c.name ?? c.phone ?? "WhatsApp customer"}${c.reason ? ` · ${c.reason}` : ""}`,
          tone: "error",
          duration: 12000,
          action: { label: "Open chat", onClick: () => router.push(`/inbox?c=${c.id}`) },
        });
      }
    },
    [router, toast],
  );

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      const result = await fetchLiveSnapshotAction();
      if (!result.ok) return;
      const awaiting = result.data.orders.filter((o) => o.status === "awaiting_acceptance");
      const fresh = awaiting.filter((o) => !known.current.has(o.id));
      known.current = new Set(awaiting.map((o) => o.id));
      setSnapshot(result.data);
      announce(fresh);
      const chats = result.data.needsStaff ?? [];
      const freshChats = chats.filter((c) => !knownChats.current.has(c.id));
      knownChats.current = new Set(chats.map((c) => c.id));
      announceChats(freshChats);
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [announce, announceChats]);

  // Realtime + polling fallback + catch-up (shared with the kitchen screen).
  const filter = branchIds.length === 1 ? `branch_id=eq.${branchIds[0]}` : `restaurant_id=eq.${restaurantId}`;
  const { realtime, online } = useLiveRefresh({ table: "orders", filter, refresh });
  // Bot handoffs ("Needs staff") come from WhatsApp conversations, not orders.
  useLiveRefresh({ table: "whatsapp_conversations", filter: `restaurant_id=eq.${restaurantId}`, refresh });

  // Clock for "x min ago", urgent and late.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // Sound preference (per device) + unlock on the first tap anywhere.
  useEffect(() => {
    const pref = soundPreference();
    soundOnRef.current = pref;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read device preference after mount (no SSR access to localStorage)
    setSoundOn(pref);
    if (!pref) return;
    const unlock = () => void unlockAudio().then(setAudioUnlocked);
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const urgent = useMemo(
    () =>
      snapshot.orders.filter(
        (o) =>
          o.status === "awaiting_acceptance" &&
          minutesSince(o.createdAt, now) >= (snapshot.settings[o.branchId]?.acceptAlertMinutes ?? 3),
      ),
    [snapshot, now],
  );

  // Repeat the alarm every 30s while something is urgent.
  const urgentCount = urgent.length;
  useEffect(() => {
    if (!urgentCount || !soundOn) return;
    playChime(true);
    const id = setInterval(() => playChime(true), URGENT_REPEAT_MS);
    return () => clearInterval(id);
  }, [urgentCount, soundOn]);

  // Tab title: "(2) New orders · …"
  const pending = snapshot.stats.pending;
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(TITLE_PREFIX, "");
      const next = pending ? `(${pending}) New order${pending === 1 ? "" : "s"} · ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const id = setInterval(apply, 1500); // page navigations reset the title
    return () => {
      clearInterval(id);
      document.title = document.title.replace(TITLE_PREFIX, "");
    };
  }, [pending]);

  const isLate = useCallback(
    (o: BoardOrder) =>
      ["awaiting_acceptance", "accepted", "preparing"].includes(o.status) &&
      minutesSince(o.createdAt, now) >= (snapshot.settings[o.branchId]?.lateOrderMinutes ?? 30),
    [now, snapshot.settings],
  );

  const sound = useMemo(
    () => ({
      enabled: soundOn,
      needsTap: soundOn && !audioUnlocked && !audioReady(),
      enable: async () => {
        const ok = await unlockAudio();
        setAudioUnlocked(ok);
        setSoundPreference(true);
        soundOnRef.current = true;
        setSoundOn(true);
        if (ok) playChime();
      },
      disable: () => {
        setSoundPreference(false);
        soundOnRef.current = false;
        setSoundOn(false);
      },
    }),
    [soundOn, audioUnlocked],
  );

  const value = useMemo<LiveContext>(
    () => ({ snapshot, refresh, realtime, online, highlighted, urgent, isLate, now, timezone, sound }),
    [snapshot, refresh, realtime, online, highlighted, urgent, isLate, now, timezone, sound],
  );

  return <Ctx value={value}>{children}</Ctx>;
}
