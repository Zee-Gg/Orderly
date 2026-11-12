"use server";

import { requirePermission } from "@/lib/auth/session";
import { getRiderCash, getRiderHome, type RiderHome, type Settlement, type UnsettledOrder } from "./queries";

/** The rider page refreshes with this (realtime event, polling, reconnect). */
export async function fetchRiderHomeAction(): Promise<RiderHome | null> {
  const ctx = await requirePermission("deliveries.view");
  return getRiderHome(ctx);
}

/** Owner/manager: a rider's unsettled cash orders + settlement history. */
export async function fetchRiderCashAction(riderId: string): Promise<{ unsettled: UnsettledOrder[]; history: Settlement[] } | null> {
  const ctx = await requirePermission("riders.manage");
  if (!/^[0-9a-f-]{36}$/i.test(riderId)) return null;
  return getRiderCash(ctx, riderId);
}
