"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnline } from "@/components/ui/offline-banner";
import { createClient } from "@/lib/supabase/client";

export type RealtimeState = "connecting" | "live" | "polling";

const POLL_MS = 20_000;
const SAFETY_POLL_MS = 60_000;

/**
 * Keep a screen fresh: listen to Supabase Realtime changes on `table`
 * (RLS-filtered), and call `refresh` (debounced) when anything changes.
 *
 * Reliability for weak internet:
 * - joins realtime WITH the user's session token (otherwise RLS hides every row)
 * - catches up on (re)subscribe, when back online, and when the tab is visible
 * - polls every 20s while realtime is down, and every 60s as a safety net
 */
export function useLiveRefresh({
  table,
  filter,
  refresh,
}: {
  table: "orders" | "order_events";
  /** postgres_changes filter, e.g. "branch_id=eq.<id>" */
  filter: string;
  refresh: () => Promise<void> | void;
}) {
  const online = useOnline();
  const [realtime, setRealtime] = useState<RealtimeState>("connecting");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const scheduleRefresh = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void refreshRef.current(), 350);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setRealtime("polling");
        return;
      }
      await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel(`live:${table}:${filter}`)
        .on("postgres_changes", { event: "*", schema: "public", table, filter }, scheduleRefresh)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setRealtime("live");
            scheduleRefresh(); // catch up on anything missed while disconnected
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setRealtime("polling");
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [table, filter, scheduleRefresh]);

  useEffect(() => {
    const id = setInterval(() => void refreshRef.current(), realtime === "live" ? SAFETY_POLL_MS : POLL_MS);
    return () => clearInterval(id);
  }, [realtime]);

  useEffect(() => {
    if (online) scheduleRefresh();
  }, [online, scheduleRefresh]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && scheduleRefresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [scheduleRefresh]);

  return { realtime, online, scheduleRefresh };
}

/** Keep the screen on (kitchen tablets). Fails silently where unsupported. */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = async () => {
      try {
        if (document.visibilityState !== "visible" || stopped) return;
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Not allowed (battery saver, no permission): ignore.
      }
    };
    void request();
    // The lock is released when the tab is hidden; take it again on return.
    const onVisible = () => void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [enabled]);
}
