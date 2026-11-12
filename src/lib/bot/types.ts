import type { BranchMenu, CartItemInput, PricingResult } from "@/lib/menu/pricing";
import type { CreatedOrder, EngineResult } from "@/lib/orders/engine";
import type { DeliveryZone } from "@/lib/delivery/zones";
import type { FaqRecord, OfferRecord } from "./knowledge";

/** Shared bot types. No Next.js imports. */

export const BOT_LANGUAGES = ["roman_urdu", "english", "urdu"] as const;
export type BotLanguage = (typeof BOT_LANGUAGES)[number];

export const BOT_STAGES = [
  "collecting_items",
  "choosing_order_type",
  "collecting_address",
  "choosing_payment",
  "collecting_name",
  "awaiting_confirmation",
  "done",
] as const;
export type BotStage = (typeof BOT_STAGES)[number];

export const BOT_STATUSES = ["active", "awaiting_confirmation", "completed", "abandoned", "handed_off"] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

export type BotPaymentMethod = "cod" | "card_on_delivery";
export type BotOrderType = "delivery" | "pickup";

/**
 * One cart line. The choice fields (ids) are what we send to the pricing
 * engine; the display fields are copied from its result (never computed here).
 */
export type CartLine = {
  lineId: string;
  itemId: string;
  variantId: string | null;
  optionIds: string[];
  removals: string[];
  quantity: number;
  notes: string;
  name: string;
  nameUr: string | null;
  sizeName: string | null;
  options: { name: string; nameUr: string | null }[];
  unitPrice: number;
  lineTotal: number;
};

export type TranscriptEntry = { role: "customer" | "bot"; text: string; at: string };

export type BotSession = {
  id: string;
  restaurantId: string;
  branchId: string;
  conversationId: string | null;
  customerId: string | null;
  status: BotStatus;
  stage: BotStage;
  cart: CartLine[];
  orderType: BotOrderType | null;
  address: {
    text: string | null;
    area: string | null;
    landmark: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  paymentMethod: BotPaymentMethod | null;
  language: BotLanguage;
  failedAttempts: number;
  summaryHash: string | null;
  orderId: string | null;
  handoffReason: string | null;
  transcript: TranscriptEntry[];
  lastActivityAt: string;
  createdAt: string;
  /** The menu-page cart draft this session loaded (Phase 8, conversion stats). */
  cartDraftId: string | null;
  /** A menu-page code waiting for the customer to tap "Replace" or "Add". */
  pendingCartCode: string | null;
  /** Delivery zone matched from the address/pin (Phase 9): fee + minimum for the summary. */
  deliveryZone: SessionZone | null;
};

export type SessionZone = {
  status: "zone" | "unlisted" | "out_of_range";
  zoneId: string | null;
  name: string | null;
  fee: number;
  minimumOrder: number;
  etaMinutes: number | null;
  /** "Area not in list — check" for unlisted areas delivered at the default fee. */
  flag: string | null;
};

/** A cart sent from the customer menu page (Phase 8). Choices only, never prices. */
export type CartDraftLine = {
  itemId: string;
  variantId: string | null;
  optionIds: string[];
  removals: string[];
  quantity: number;
  notes: string;
};

export type CartDraft = {
  id: string;
  code: string;
  branchId: string;
  orderType: BotOrderType | null;
  lines: CartDraftLine[];
  expiresAt: string;
  usedAt: string | null;
};

export type RestaurantInfo = {
  id: string;
  name: string;
  /** For the menu page link (/m/[slug]). */
  slug: string;
  phone: string | null;
  timezone: string;
  botEnabled: boolean;
  highValueCodThreshold: number;
  /** Mention one current offer when a new chat starts. */
  mentionOfferOnGreeting: boolean;
  dineInAvailable: boolean;
  paymentMethods: BotPaymentMethod[];
};

export type BranchInfo = {
  id: string;
  name: string;
  /** Open switch on AND inside opening hours right now. */
  isOpenNow: boolean;
  /** e.g. "12:00 PM – 11:59 PM" or "Closed today". */
  todayHours: string;
  address: string | null;
  area: string | null;
  phone: string | null;
  deliveryFee: number;
  minimumOrder: number;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  /** All week, one line per day ("Mon: 12:00 PM – 11:00 PM"). */
  weekHours: string;
  prepMinutes: number;
  deliveryMinutes: number;
  /** Phase 9: optional radius check and what to do with areas not in the zone list. */
  maxDeliveryRadiusKm: number | null;
  unlistedAreaPolicy: "reject" | "default_fee";
};

/** Something a tool sends besides the text reply (image, PDF, location pin, extra text). */
export type BotMedia =
  | { kind: "image"; url: string; caption?: string }
  | { kind: "document"; url: string; fileName: string; caption?: string }
  | { kind: "location"; latitude: number; longitude: number; name: string; address: string }
  | { kind: "text"; text: string };

export type CustomerInfo = {
  id: string;
  name: string | null;
  phone: string;
  isBlocked: boolean;
  /** Orders placed before (0 = new customer). */
  totalOrders: number;
  preferredLanguage: BotLanguage | null;
};

export type RecentOrder = {
  orderNumber: number;
  status: string;
  orderType: string;
  total: number;
  createdAt: string;
};

export type BotOrderInput = {
  session: BotSession;
  customer: CustomerInfo;
  deliveryFee: number;
  idempotencyKey: string;
  deliveryZoneId?: string | null;
};

export type AiLogRow = {
  /** chat = a bot turn; transcription = a voice note turned into text. Default chat. */
  type?: "chat" | "transcription";
  restaurantId: string;
  sessionId: string | null;
  inputText: string;
  toolCalls: unknown[];
  replyText: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCost: number;
  latencyMs: number;
  /** flood = customer sent >10 messages a minute; budget = monthly AI budget reached. */
  errorType: "rate_limit" | "timeout" | "error" | "flood" | "budget" | null;
  error: string | null;
};

/**
 * Everything the bot needs from the database. Supabase version in store.ts
 * (admin client, always scoped by restaurant_id); in-memory fake for tests.
 */
export interface BotStore {
  getRestaurant(restaurantId: string): Promise<RestaurantInfo | null>;
  getBranch(restaurantId: string, branchId: string, now: Date): Promise<BranchInfo | null>;
  getMenu(restaurantId: string, branchId: string): Promise<BranchMenu>;
  /** The pricing engine (resolveCartItem). */
  priceLine(input: CartItemInput): Promise<PricingResult>;
  getCustomer(restaurantId: string, customerId: string): Promise<CustomerInfo | null>;
  setCustomerName(restaurantId: string, customerId: string, name: string): Promise<void>;
  setCustomerLanguage(restaurantId: string, customerId: string, language: BotLanguage): Promise<void>;
  getSession(restaurantId: string, sessionId: string): Promise<BotSession | null>;
  createSession(input: {
    restaurantId: string;
    branchId: string;
    conversationId: string | null;
    customerId: string | null;
    language: BotLanguage;
  }): Promise<BotSession>;
  saveSession(session: BotSession): Promise<void>;
  recentOrders(restaurantId: string, customerId: string, limit: number): Promise<RecentOrder[]>;
  /** The order engine (createOrder, source whatsapp, status awaiting_acceptance). */
  createOrder(input: BotOrderInput): Promise<EngineResult<CreatedOrder>>;
  setRiskFlag(restaurantId: string, orderId: string, flag: string): Promise<void>;
  /** Active menu images/PDF for a branch (branch-specific + all-branch), in order, with public URLs. */
  getMenuMedia(restaurantId: string, branchId: string): Promise<{ type: "image" | "pdf"; url: string; fileName: string | null }[]>;
  getOffers(restaurantId: string): Promise<OfferRecord[]>;
  getFaqs(restaurantId: string): Promise<FaqRecord[]>;
  /** Items by quantity sold at this branch since a date (bestsellers). */
  getBestsellerCounts(restaurantId: string, branchId: string, sinceIso: string): Promise<{ itemId: string; quantity: number }[]>;
  /** A WhatsApp-ready (JPEG) public URL for an item photo, or null. */
  getItemPhotoUrl(restaurantId: string, itemId: string, imageUrl: string | null): Promise<string | null>;
  /** A menu-page cart draft by code (any state: used/expired too), or null. */
  findCartDraft(restaurantId: string, code: string): Promise<CartDraft | null>;
  /** Marks a draft used — atomically, only if unused and not expired. True = this caller got it. */
  claimCartDraft(restaurantId: string, draftId: string, by: { customerId: string | null; sessionId: string; now: Date }): Promise<boolean>;
  /** Active delivery zones of a branch (Phase 9). */
  getDeliveryZones(restaurantId: string, branchId: string): Promise<DeliveryZone[]>;
  logTurn(row: AiLogRow): Promise<void>;
}
