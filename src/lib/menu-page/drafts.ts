import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveCartItem, type PricingErrorCode } from "@/lib/menu/pricing";
import { isOpenAt, toOpeningHours } from "@/lib/opening-hours";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import type { Database, Json } from "@/types/database";
import { generateCode } from "./code";

/**
 * Cart drafts from the customer menu page (Phase 8). The page sends CHOICES
 * only (item, size, extras, removals, quantity, note); every line is re-priced
 * here with the pricing engine. The draft gets a short code the customer sends
 * on WhatsApp; the bot loads it (src/lib/bot/cart-draft.ts). Admin client,
 * always scoped by the restaurant found from the slug. No Next.js imports.
 */
type Db = SupabaseClient<Database>;

export const DRAFT_LIMITS = { perIpPerHour: 20, maxLines: 30, ttlMs: 2 * 3600_000 } as const;

const uuid = z.uuid();
export const draftLineSchema = z.object({
  itemId: uuid,
  variantId: uuid.nullish(),
  optionIds: z.array(uuid).max(30).default([]),
  removals: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().trim().max(200).default(""),
});

export const createDraftSchema = z.object({
  slug: z.string().trim().min(1).max(60),
  branchId: uuid,
  orderType: z.enum(["delivery", "pickup"]).nullish(),
  language: z.enum(["en", "ur"]).default("en"),
  lines: z.array(draftLineSchema).min(1, "Your cart is empty").max(DRAFT_LIMITS.maxLines, `At most ${DRAFT_LIMITS.maxLines} lines`),
});
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export type DraftProblem = { index: number; itemId: string; code: PricingErrorCode; message: string };

export type CreateDraftResult =
  | {
      ok: true;
      code: string;
      expiresAt: string;
      lines: { index: number; name: string; nameUr: string | null; sizeName: string | null; quantity: number; lineTotal: number }[];
      subtotal: number;
    }
  | { ok: false; error: "NOT_FOUND" | "CLOSED" | "NO_WHATSAPP" | "RATE_LIMITED" | "INVALID_LINES"; message: string; problems?: DraftProblem[] };

type PublicInfo = {
  restaurant: { id: string; timezone: string | null };
  branch_id: string;
  whatsapp_number: string | null;
  branches: { id: string; is_open: boolean; opening_hours: unknown }[];
};

export async function createCartDraft(
  db: Db,
  input: CreateDraftInput,
  deps: { ipHash: string | null; now?: Date; random?: () => number } = { ipHash: null },
): Promise<CreateDraftResult> {
  const now = deps.now ?? new Date();

  // 1. Restaurant (trial/active) and branch, from the public info RPC.
  const { data, error } = await db.rpc("get_public_menu_info", { p_slug: input.slug, p_branch_id: input.branchId });
  if (error) throw new Error(`public info: ${error.message}`);
  const info = data as unknown as PublicInfo | null;
  const branch = info?.branches.find((b) => b.id === input.branchId);
  if (!info || !branch || info.branch_id !== input.branchId) return { ok: false, error: "NOT_FOUND", message: "This menu is not available." };
  if (!info.whatsapp_number) return { ok: false, error: "NO_WHATSAPP", message: "This restaurant hasn't connected WhatsApp yet." };
  const tz = info.restaurant.timezone || DEFAULT_TIMEZONE;
  if (!branch.is_open || !isOpenAt(toOpeningHours(branch.opening_hours), now, tz)) {
    return { ok: false, error: "CLOSED", message: "The restaurant is closed now." };
  }
  const restaurantId = info.restaurant.id;

  // 2. Rate limit per IP.
  if (deps.ipHash) {
    const { count, error: cErr } = await db
      .from("cart_drafts")
      .select("id", { count: "exact", head: true })
      .eq("created_ip_hash", deps.ipHash)
      .gt("created_at", new Date(now.getTime() - 3600_000).toISOString());
    if (cErr) throw new Error(`rate limit: ${cErr.message}`);
    if ((count ?? 0) >= DRAFT_LIMITS.perIpPerHour) {
      return { ok: false, error: "RATE_LIMITED", message: "Too many orders from this phone. Please try again later." };
    }
  }

  // 3. Every line through the pricing engine (never trust the page's prices).
  const priced = await Promise.all(
    input.lines.map((l) =>
      resolveCartItem(db, {
        restaurantId,
        branchId: input.branchId,
        itemId: l.itemId,
        variantId: l.variantId ?? null,
        modifierOptionIds: l.optionIds,
        removals: l.removals,
        quantity: l.quantity,
      }),
    ),
  );
  const problems: DraftProblem[] = [];
  priced.forEach((r, index) => {
    if (!r.ok) problems.push({ index, itemId: input.lines[index].itemId, code: r.errors[0].code, message: r.errors[0].message });
  });
  if (problems.length) return { ok: false, error: "INVALID_LINES", message: "Some items changed. Please check your order.", problems };
  const lines = priced.map((r, index) => {
    if (!r.ok) throw new Error("unreachable");
    return { index, name: r.line.itemName, nameUr: r.line.itemNameUr, sizeName: r.line.sizeName, quantity: r.line.quantity, lineTotal: r.line.lineTotal };
  });

  // 4. Save with a unique, readable code (retry on a clash; 5 characters after a few).
  const rows = input.lines.map((l, i) => {
    const r = priced[i];
    return {
      item_id: l.itemId,
      variant_id: r.ok ? r.line.variantId : null,
      option_ids: r.ok ? r.line.options.map((o) => o.id) : l.optionIds,
      removals: r.ok ? r.line.removals : l.removals,
      quantity: l.quantity,
      notes: l.notes,
    };
  });
  const expiresAt = new Date(now.getTime() + DRAFT_LIMITS.ttlMs).toISOString();
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateCode(attempt < 6 ? 4 : 5, deps.random);
    const { error: insErr } = await db.from("cart_drafts").insert({
      code,
      restaurant_id: restaurantId,
      branch_id: input.branchId,
      order_type: input.orderType ?? null,
      lines: rows as unknown as Json,
      language: input.language === "ur" ? "urdu" : "english",
      created_at: now.toISOString(),
      expires_at: expiresAt,
      created_ip_hash: deps.ipHash,
    });
    if (!insErr) return { ok: true, code, expiresAt, lines, subtotal: lines.reduce((s, l) => s + l.lineTotal, 0) };
    if (insErr.code !== "23505") throw new Error(`save draft: ${insErr.message}`);
  }
  throw new Error("save draft: no free code");
}
