import type { OrderSummary } from "../cart";
import type { MenuIndex } from "../menu-index";
import type { BotMedia, BotSession, BotStore, BranchInfo, CustomerInfo, RestaurantInfo } from "../types";

/**
 * What every tool can see and change during one customer turn. Tools mutate
 * `session` in memory; the agent saves it once at the end of the turn.
 */
export type BotContext = {
  store: BotStore;
  session: BotSession;
  restaurant: RestaurantInfo;
  branch: BranchInfo;
  customer: CustomerInfo | null;
  now: () => Date;
  /** Branch menu + short refs, loaded once per turn. */
  menu: () => Promise<MenuIndex>;
  /** Side effects the agent turns into the reply / buttons. */
  effects: {
    summary: OrderSummary | null;
    order: { id: string; orderNumber: number } | null;
    handedOff: boolean;
    cancelled: boolean;
    /** Images, PDFs, location pins, extra texts to send before the reply. */
    media: BotMedia[];
  };
};

/** Every tool result: ok + data, or a clear error code the AI can act on. */
export type ToolResult = { ok: true; [key: string]: unknown } | { ok: false; error: string; message: string; [key: string]: unknown };

export const fail = (error: string, message: string, extra: Record<string, unknown> = {}): ToolResult => ({
  ok: false,
  error,
  message,
  ...extra,
});
