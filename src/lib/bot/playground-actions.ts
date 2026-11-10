"use server";

import { z } from "zod";
import { failure, type ActionResult } from "@/lib/action-result";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { runBotTurn, startSession, type BotButton } from "./agent";
import { createSupabaseBotStore } from "./store";
import type { BotSession } from "./types";

/**
 * Bot playground (development only + super admin). Runs the REAL bot engine
 * against a real restaurant: orders it creates show on /orders.
 */
async function guard() {
  if (process.env.NODE_ENV === "production") throw new Error("The bot playground is only available in development.");
  await requireSuperAdmin();
  return createAdminClient();
}

export type PlaygroundSession = Pick<
  BotSession,
  "id" | "status" | "stage" | "cart" | "orderType" | "address" | "paymentMethod" | "language" | "failedAttempts" | "orderId" | "handoffReason"
>;

const view = (s: BotSession): PlaygroundSession => ({
  id: s.id,
  status: s.status,
  stage: s.stage,
  cart: s.cart,
  orderType: s.orderType,
  address: s.address,
  paymentMethod: s.paymentMethod,
  language: s.language,
  failedAttempts: s.failedAttempts,
  orderId: s.orderId,
  handoffReason: s.handoffReason,
});

export type PlaygroundCustomer = { id: string; name: string | null; phone: string; totalOrders: number };

const restaurantSchema = z.object({ restaurantId: z.uuid() });

export async function listPlaygroundCustomersAction(input: z.input<typeof restaurantSchema>): Promise<ActionResult<PlaygroundCustomer[]>> {
  try {
    const db = await guard();
    const { restaurantId } = restaurantSchema.parse(input);
    const { data, error } = await db
      .from("customers")
      .select("id, name, phone, total_orders")
      .eq("restaurant_id", restaurantId)
      .order("last_order_at", { ascending: false, nullsFirst: false })
      .limit(30);
    if (error) throw error;
    return { ok: true, data: (data ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone, totalOrders: c.total_orders })) };
  } catch (err) {
    return failure(err, "Couldn't load customers.");
  }
}

const startSchema = z.object({
  restaurantId: z.uuid(),
  branchId: z.uuid(),
  customer: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("new"), name: z.string().trim().max(60).optional() }),
    z.object({ mode: z.literal("existing"), customerId: z.uuid() }),
  ]),
});

export async function startPlaygroundAction(
  input: z.input<typeof startSchema>,
): Promise<ActionResult<{ session: PlaygroundSession; customer: PlaygroundCustomer }>> {
  try {
    const db = await guard();
    const v = startSchema.parse(input);
    const { data: branch } = await db.from("branches").select("id").eq("id", v.branchId).eq("restaurant_id", v.restaurantId).maybeSingle();
    if (!branch) return { ok: false, error: "Choose a branch of this restaurant." };

    let customerId: string;
    if (v.customer.mode === "new") {
      // A random but valid Pakistani mobile number (the order engine validates phones).
      const phone = `+92300${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
      const { data, error } = await db
        .from("customers")
        .insert({ restaurant_id: v.restaurantId, phone, name: v.customer.name || null, notes: "Bot playground test customer" })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Couldn't create the test customer");
      customerId = data.id;
    } else {
      customerId = v.customer.customerId;
    }
    const { data: c } = await db
      .from("customers")
      .select("id, name, phone, total_orders")
      .eq("id", customerId)
      .eq("restaurant_id", v.restaurantId)
      .maybeSingle();
    if (!c) return { ok: false, error: "Customer not found." };

    const session = await startSession(createSupabaseBotStore(db), { restaurantId: v.restaurantId, branchId: v.branchId, customerId });
    return { ok: true, data: { session: view(session), customer: { id: c.id, name: c.name, phone: c.phone, totalOrders: c.total_orders } } };
  } catch (err) {
    return failure(err, "Couldn't start a session.");
  }
}

const sendSchema = z.object({
  restaurantId: z.uuid(),
  branchId: z.uuid(),
  sessionId: z.uuid(),
  customerId: z.uuid(),
  messages: z.array(z.string().trim().min(1).max(1000)).min(1).max(10),
  buttonId: z.string().trim().max(40).optional(),
});

export type PlaygroundTurn = {
  replyText: string | null;
  showButtons: BotButton[] | null;
  orderCreated: { id: string; orderNumber: number } | null;
  handedOff: boolean;
  session: PlaygroundSession;
  toolCalls: { tool: string; input: unknown; output: unknown; ms: number }[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  estimatedCost: number;
  latencyMs: number;
  provider: string;
  model: string;
  error: { type: string; message: string } | null;
};

export async function sendPlaygroundMessageAction(input: z.input<typeof sendSchema>): Promise<ActionResult<PlaygroundTurn>> {
  try {
    const db = await guard();
    const v = sendSchema.parse(input);
    const r = await runBotTurn(
      {
        restaurantId: v.restaurantId,
        branchId: v.branchId,
        sessionId: v.sessionId,
        customerId: v.customerId,
        customerMessages: v.messages,
        buttonId: v.buttonId ?? null,
      },
      { store: createSupabaseBotStore(db) },
    );
    return {
      ok: true,
      data: {
        replyText: r.replyText,
        showButtons: r.showButtons,
        orderCreated: r.orderCreated,
        handedOff: r.handedOff,
        session: view(r.session),
        toolCalls: r.toolCalls.map((c) => ({ tool: c.tool, input: c.input, output: c.output, ms: c.ms })),
        usage: r.usage,
        estimatedCost: r.estimatedCost,
        latencyMs: r.latencyMs,
        provider: r.provider,
        model: r.model,
        error: r.error,
      },
    };
  } catch (err) {
    return failure(err, "The bot couldn't answer.");
  }
}
