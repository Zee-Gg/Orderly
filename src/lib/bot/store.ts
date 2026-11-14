import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBranchMenu, resolveCartItem } from "@/lib/menu/pricing";
import { formatDayHours, isOpenAt, toOpeningHours, WEEKDAYS, weekdayAt } from "@/lib/opening-hours";
import { createOrder } from "@/lib/orders/engine";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import type { Database, Json } from "@/types/database";
import type { FaqRecord, OfferRecord } from "./knowledge";
import type { BotLanguage, BotPaymentMethod, BotSession, BotStore, CartDraft, CartLine, TranscriptEntry } from "./types";

const DAY_NAMES: Record<(typeof WEEKDAYS)[number], string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export { BOT_MEDIA_BUCKET } from "./media-constants";
import { BOT_MEDIA_BUCKET } from "./media-constants";

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
    cartDraftId: r.cart_draft_id,
    pendingCartCode: r.pending_cart_code,
    deliveryZone: (r.delivery_zone as unknown as BotSession["deliveryZone"]) ?? null,
    locationRequested: r.location_requested ?? false,
  };
}

type DraftRow = Database["public"]["Tables"]["cart_drafts"]["Row"];
function toDraft(r: DraftRow): CartDraft {
  const lines = (Array.isArray(r.lines) ? r.lines : []) as {
    item_id: string;
    variant_id: string | null;
    option_ids: string[] | null;
    removals: string[] | null;
    quantity: number;
    notes: string | null;
  }[];
  return {
    id: r.id,
    code: r.code,
    branchId: r.branch_id,
    orderType: r.order_type as CartDraft["orderType"],
    lines: lines.map((l) => ({
      itemId: l.item_id,
      variantId: l.variant_id ?? null,
      optionIds: l.option_ids ?? [],
      removals: l.removals ?? [],
      quantity: l.quantity,
      notes: l.notes ?? "",
    })),
    expiresAt: r.expires_at,
    usedAt: r.used_at,
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
          .select("id, name, slug, phone, status, timezone, bot_enabled, high_value_cod_threshold, mention_offer_on_greeting, dine_in_available, payment_methods")
          .eq("id", restaurantId)
          .maybeSingle(),
        "restaurant",
      );
      return r
        ? {
            id: r.id,
            name: r.name,
            slug: r.slug,
            phone: r.phone,
            timezone: r.timezone || DEFAULT_TIMEZONE,
            botEnabled: r.bot_enabled,
            highValueCodThreshold: r.high_value_cod_threshold,
            mentionOfferOnGreeting: r.mention_offer_on_greeting,
            dineInAvailable: r.dine_in_available,
            paymentMethods: (r.payment_methods.length ? r.payment_methods : ["cod"]) as BotPaymentMethod[],
            suspended: r.status === "suspended",
          }
        : null;
    },

    async getBranch(restaurantId, branchId, now) {
      const [b, r] = await Promise.all([
        db
          .from("branches")
          .select(
            "id, name, address, area, phone, is_open, is_active, opening_hours, default_delivery_fee, minimum_order, latitude, longitude, google_maps_url, default_prep_minutes, delivery_minutes, max_delivery_radius_km, unlisted_area_policy",
          )
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
        latitude: branch.latitude,
        longitude: branch.longitude,
        mapsUrl: branch.google_maps_url,
        weekHours: WEEKDAYS.map((d) => `${DAY_NAMES[d]}: ${formatDayHours(hours[d])}`).join("\n"),
        prepMinutes: branch.default_prep_minutes,
        deliveryMinutes: branch.delivery_minutes,
        maxDeliveryRadiusKm: branch.max_delivery_radius_km,
        unlistedAreaPolicy: branch.unlisted_area_policy === "reject" ? "reject" : "default_fee",
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
            branch_id: s.branchId,
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
            cart_draft_id: s.cartDraftId,
            pending_cart_code: s.pendingCartCode,
            delivery_zone: s.deliveryZone as unknown as Json,
            location_requested: s.locationRequested,
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

    async createOrder({ session, customer, deliveryFee, idempotencyKey, deliveryZoneId }) {
      const result = await createOrder(
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
      if (result.ok && deliveryZoneId && session.orderType === "delivery") {
        await db.from("orders").update({ delivery_zone_id: deliveryZoneId }).eq("id", result.data.id).eq("restaurant_id", session.restaurantId);
      }
      return result;
    },

    async setRiskFlag(restaurantId, orderId, flag) {
      check(await db.from("orders").update({ risk_flag: flag }).eq("id", orderId).eq("restaurant_id", restaurantId), "risk flag");
    },

    async getMenuMedia(restaurantId, branchId) {
      const rows = check(
        await db
          .from("menu_media")
          .select("type, storage_path, file_name, branch_id, sort_order, uploaded_at")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .or(`branch_id.is.null,branch_id.eq.${branchId}`)
          .order("sort_order")
          .order("uploaded_at"),
        "menu media",
      );
      return (rows ?? []).map((m) => ({
        type: m.type as "image" | "pdf",
        url: db.storage.from(BOT_MEDIA_BUCKET).getPublicUrl(m.storage_path).data.publicUrl,
        fileName: m.file_name,
      }));
    },

    async getOffers(restaurantId) {
      const rows = check(
        await db
          .from("offers")
          .select("id, branch_id, title, title_ur, description, menu_item_id, image_path, starts_at, ends_at, days_of_week, start_time, end_time, is_active, sort_order")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .order("sort_order"),
        "offers",
      );
      return (rows ?? []).map(
        (o): OfferRecord => ({
          id: o.id,
          branchId: o.branch_id,
          title: o.title,
          titleUr: o.title_ur,
          description: o.description,
          menuItemId: o.menu_item_id,
          imagePath: o.image_path,
          startsAt: o.starts_at,
          endsAt: o.ends_at,
          daysOfWeek: o.days_of_week,
          startTime: o.start_time,
          endTime: o.end_time,
          isActive: o.is_active,
          sortOrder: o.sort_order,
        }),
      );
    },

    async getFaqs(restaurantId) {
      const rows = check(
        await db
          .from("restaurant_faqs")
          .select("id, question, answer, answer_ur, keywords, is_active, sort_order")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .order("sort_order"),
        "faqs",
      );
      return (rows ?? []).map(
        (f): FaqRecord => ({ id: f.id, question: f.question, answer: f.answer, answerUr: f.answer_ur, keywords: f.keywords, isActive: f.is_active, sortOrder: f.sort_order }),
      );
    },

    async getBestsellerCounts(restaurantId, branchId, sinceIso) {
      const { data, error } = await db.rpc("bot_bestsellers", { p_restaurant_id: restaurantId, p_branch_id: branchId, p_since: sinceIso, p_limit: 10 });
      if (error) throw new Error(`bestsellers: ${error.message}`);
      return (data ?? []).map((r) => ({ itemId: r.item_id, quantity: Number(r.quantity) }));
    },

    async getItemPhotoUrl(restaurantId, itemId, imageUrl) {
      if (!imageUrl) return null;
      // WhatsApp image messages take JPEG/PNG only; item photos are WebP. Keep a JPEG copy in bot-media.
      const key = createHash("sha1").update(imageUrl).digest("hex").slice(0, 12);
      const path = `${restaurantId}/photos/${itemId}-${key}.jpg`;
      const bucket = db.storage.from(BOT_MEDIA_BUCKET);
      const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
      const { data: existing } = await bucket.list(`${restaurantId}/photos`, { search: `${itemId}-${key}.jpg`, limit: 1 });
      if (existing?.length) return publicUrl;
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (!res?.ok) return null;
      const sharp = (await import("sharp")).default;
      const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      const { error } = await bucket.upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(`item photo: ${error.message}`);
      return publicUrl;
    },

    async getDeliveryZones(restaurantId, branchId) {
      const rows = check(
        await db
          .from("delivery_zones")
          .select("id, name, aliases, delivery_fee, minimum_order, estimated_minutes, is_active")
          .eq("restaurant_id", restaurantId)
          .eq("branch_id", branchId)
          .eq("is_active", true)
          .order("sort_order"),
        "delivery zones",
      );
      return (rows ?? []).map((z) => ({
        id: z.id,
        name: z.name,
        aliases: z.aliases,
        deliveryFee: z.delivery_fee,
        minimumOrder: z.minimum_order,
        estimatedMinutes: z.estimated_minutes,
        isActive: z.is_active,
      }));
    },

    async findCartDraft(restaurantId, code) {
      const r = check(
        await db.from("cart_drafts").select("*").eq("restaurant_id", restaurantId).eq("code", code.toUpperCase()).maybeSingle(),
        "cart draft",
      );
      return r ? toDraft(r) : null;
    },

    async claimCartDraft(restaurantId, draftId, by) {
      const rows = check(
        await db
          .from("cart_drafts")
          .update({ used_at: by.now.toISOString(), used_by_customer_id: by.customerId, session_id: by.sessionId })
          .eq("id", draftId)
          .eq("restaurant_id", restaurantId)
          .is("used_at", null)
          .gt("expires_at", by.now.toISOString())
          .select("id"),
        "claim cart draft",
      );
      return (rows ?? []).length === 1;
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
