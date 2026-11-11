import type { BranchMenu, CartItemInput, PricingResult } from "@/lib/menu/pricing";
import type { CreatedOrder, EngineResult } from "@/lib/orders/engine";

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
};

export type RestaurantInfo = {
  id: string;
  name: string;
  phone: string | null;
  timezone: string;
  botEnabled: boolean;
  highValueCodThreshold: number;
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
};

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
  logTurn(row: AiLogRow): Promise<void>;
}
