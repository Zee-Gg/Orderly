import type { SupabaseClient } from "@supabase/supabase-js";
import { getBranchMenu, resolveCartItem } from "@/lib/menu/pricing";
import { formatDayHours, isOpenAt, toOpeningHours, weekdayAt } from "@/lib/opening-hours";
import { createOrder } from "@/lib/orders/engine";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import type { Database, Json } from "@/types/database";
import type { BotLanguage, BotSession, BotStore, CartLine, TranscriptEntry } from "./types";

/**
 * Supabase BotStore. Uses the ADMIN client (the bot has no user session):
 * every query is scoped by restaurant_id explicitly. No Next.js imports.
 */
type Db = SupabaseClient<Database>;
type SessionRow = Database["public"]["Tables"]["bot_sessions"]["Row"];

const BOT_ACTOR = { type: "bot", userId: null, role: null } as const;

function toSession(r: SessionRow): BotSession {
  return {
    id: r.id,
    restaurantId: r.restaurant_id,
    branchId: r.branch_id,
    conversationId: r.conversation_id,
    customerId: r.customer_id,
    status: r.status as BotSession["status"],
    stage: r.stage as BotSession["stage"],
    cart: (Array.isArray(r.cart) ? r.cart : []) as unknown as CartLine[],
    orderType: r.order_type as BotSession["orderType"],
    address: {
      text: r.delivery_address_text,
      area: r.delivery_area,
      landmark: r.delivery_landmark,
      latitude: r.latitude,
      longitude: r.longitude,
    },
    paymentMethod: r.payment_method as BotSession["paymentMethod"],
    language: r.language as BotLanguage,
    failedAttempts: r.failed_attempts,
    summaryHash: r.summary_hash,
    orderId: r.order_id,
    handoffReason: r.handoff_reason,
    transcript: (Array.isArray(r.transcript) ? r.transcript : []) as unknown as TranscriptEntry[],
    lastActivityAt: r.last_activity_at,
    createdAt: r.created_at,
  };
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function createSupabaseBotStore(db: Db): BotStore {
  return {
    async getRestaurant(restaurantId) {
      const r = check(
        await db
          .from("restaurants")
          .select("id, name, phone, timezone, bot_enabled, high_value_cod_threshold")
          .eq("id", restaurantId)
          .maybeSingle(),
        "restaurant",
      );
      return r
        ? {
            id: r.id,
            name: r.name,
            phone: r.phone,
            timezone: r.timezone || DEFAULT_TIMEZONE,
            botEnabled: r.bot_enabled,
            highValueCodThreshold: r.high_value_cod_threshold,
          }
        : null;
    },

    async getBranch(restaurantId, branchId, now) {
      const [b, r] = await Promise.all([
        db
          .from("branches")
          .select("id, name, address, area, phone, is_open, is_active, opening_hours, default_delivery_fee, minimum_order")
          .eq("id", branchId)
          .eq("restaurant_id", restaurantId)
          .maybeSingle(),
        db.from("restaurants").select("timezone").eq("id", restaurantId).maybeSingle(),
      ]);
      const branch = check(b, "branch");
      if (!branch || !branch.is_active) return null;
      const tz = r.data?.timezone || DEFAULT_TIMEZONE;
      const hours = toOpeningHours(branch.opening_hours);
      const today = hours[weekdayAt(now, tz)];
      return {
        id: branch.id,
        name: branch.name,
        isOpenNow: branch.is_open && isOpenAt(hours, now, tz),
        todayHours: today.closed ? "Closed today" : formatDayHours(today),
        address: branch.address,
        area: branch.area,
        phone: branch.phone,
        deliveryFee: branch.default_delivery_fee,
        minimumOrder: branch.minimum_order,
      };
    },

    getMenu: (restaurantId, branchId) => getBranchMenu(db, restaurantId, branchId),
    priceLine: (input) => resolveCartItem(db, input),

    async getCustomer(restaurantId, customerId) {
      const c = check(
        await db
          .from("customers")
          .select("id, name, phone, is_blocked, total_orders, preferred_language")
          .eq("id", customerId)
          .eq("restaurant_id", restaurantId)
          .maybeSingle(),
        "customer",
      );
      return c
        ? {
            id: c.id,
            name: c.name,
            phone: c.phone,
            isBlocked: c.is_blocked,
            totalOrders: c.total_orders,
            preferredLanguage: (c.preferred_language as BotLanguage | null) ?? null,
          }
        : null;
    },

    async setCustomerName(restaurantId, customerId, name) {
      check(await db.from("customers").update({ name }).eq("id", customerId).eq("restaurant_id", restaurantId), "save name");
    },

    async setCustomerLanguage(restaurantId, customerId, language) {
      check(
        await db.from("customers").update({ preferred_language: language }).eq("id", customerId).eq("restaurant_id", restaurantId),
        "save language",
      );
    },

    async getSession(restaurantId, sessionId) {
      const s = check(
        await db.from("bot_sessions").select("*").eq("id", sessionId).eq("restaurant_id", restaurantId).maybeSingle(),
        "session",
      );
      return s ? toSession(s) : null;
    },

    async createSession(input) {
      const s = check(
        await db
          .from("bot_sessions")
          .insert({
            restaurant_id: input.restaurantId,
            branch_id: input.branchId,
            conversation_id: input.conversationId,
            customer_id: input.customerId,
            language: input.language,
          })
          .select("*")
          .single(),
        "create session",
      );
      if (!s) throw new Error("create session: no row");
      return toSession(s);
    },

    async saveSession(s) {
      check(
        await db
          .from("bot_sessions")
          .update({
            status: s.status,
            stage: s.stage,
            cart: s.cart as unknown as Json,
            order_type: s.orderType,
            delivery_address_text: s.address.text,
            delivery_area: s.address.area,
            delivery_landmark: s.address.landmark,
            latitude: s.address.latitude,
            longitude: s.address.longitude,
            payment_method: s.paymentMethod,
            language: s.language,
            failed_attempts: s.failedAttempts,
            summary_hash: s.summaryHash,
            order_id: s.orderId,
            handoff_reason: s.handoffReason,
            transcript: s.transcript as unknown as Json,
            last_activity_at: s.lastActivityAt,
          })
          .eq("id", s.id)
          .eq("restaurant_id", s.restaurantId),
        "save session",
      );
    },

    async recentOrders(restaurantId, customerId, limit) {
      const rows = check(
        await db
          .from("orders")
          .select("order_number, status, order_type, total, created_at")
          .eq("restaurant_id", restaurantId)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(limit),
        "recent orders",
      );
      return (rows ?? []).map((o) => ({
        orderNumber: o.order_number,
        status: o.status,
        orderType: o.order_type,
        total: o.total,
        createdAt: o.created_at,
      }));
    },

    async createOrder({ session, customer, deliveryFee, idempotencyKey }) {
      return createOrder(
        { admin: db, pricing: db },
        { restaurantId: session.restaurantId, branchIds: null },
        {
          branchId: session.branchId,
          idempotencyKey,
          source: "whatsapp",
          orderType: session.orderType ?? "pickup",
          paymentMethod: session.paymentMethod ?? "cod",
          customer: { phone: customer.phone, name: customer.name ?? "" },
          address:
            session.orderType === "delivery"
              ? {
                  addressText: session.address.text ?? "",
                  area: session.address.area ?? "",
                  landmark: session.address.landmark ?? "",
                  latitude: session.address.latitude,
                  longitude: session.address.longitude,
                  save: true,
                }
              : undefined,
          deliveryFee: session.orderType === "delivery" ? deliveryFee : 0,
          lines: session.cart.map((l) => ({
            itemId: l.itemId,
            variantId: l.variantId,
            optionIds: l.optionIds,
            removals: l.removals,
            quantity: l.quantity,
            notes: l.notes,
          })),
        },
        BOT_ACTOR,
        { initialStatus: "awaiting_acceptance" },
      );
    },

    async setRiskFlag(restaurantId, orderId, flag) {
      check(await db.from("orders").update({ risk_flag: flag }).eq("id", orderId).eq("restaurant_id", restaurantId), "risk flag");
    },

    async logTurn(row) {
      check(
        await db.from("ai_logs").insert({
          type: row.type ?? "chat",
          restaurant_id: row.restaurantId,
          session_id: row.sessionId,
          input_text: row.inputText.slice(0, 4000),
          tool_calls: row.toolCalls as Json,
          reply_text: row.replyText?.slice(0, 4000) ?? null,
          provider: row.provider,
          model: row.model,
          input_tokens: row.inputTokens,
          output_tokens: row.outputTokens,
          cache_read_tokens: row.cacheReadTokens,
          cache_write_tokens: row.cacheWriteTokens,
          estimated_cost: row.estimatedCost,
          latency_ms: row.latencyMs,
          error_type: row.errorType,
          error: row.error?.slice(0, 2000) ?? null,
        }),
        "ai log",
      );
    },
  };
}
