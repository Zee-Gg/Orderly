"use server";

import { unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import type { EngineResult } from "@/lib/orders/engine";
import { getKitchenSnapshot, type KitchenSnapshot } from "./queries";

/**
 * Kitchen screen data. Moving tickets (START / READY) uses the normal
 * transitionOrderAction: the order engine + state machine only let the
 * kitchen role do accepted → preparing → ready.
 */
export async function fetchKitchenSnapshotAction(): Promise<EngineResult<KitchenSnapshot>> {
  try {
    const ctx = await requirePermission("kitchen.view");
    return { ok: true, data: await getKitchenSnapshot(ctx) };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[kitchen] snapshot failed", err);
    return { ok: false, code: "UNKNOWN", message: "Couldn't load orders. Check the internet." };
  }
}
