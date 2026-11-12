/**
 * WhatsApp inbox rules (Phase 10). Pure — shared by server actions, the
 * inbox UI and tests. No DB, no Next.js.
 *
 * Bot / staff:
 *  - The bot replies only when the chat's bot is on (bot_enabled).
 *  - Staff sending a message or tapping "Take over" turns the bot off.
 *  - "Hand back to bot" turns it on; the bot waits for the customer's next message.
 *  - "Resolve" = resolved, not needs-staff, bot on.
 *  - A staff-handled chat quiet for auto_resolve_hours is resolved and the bot
 *    turned back on (done in the DB: whatsapp_record_inbound + inbox_auto_resolve).
 *  - A resolved chat that gets a new customer message reopens with the bot on.
 */

export const WINDOW_MS = 24 * 3600_000;

export type ConversationState = {
  status: "open" | "resolved";
  botEnabled: boolean;
  needsStaff: boolean;
  needsStaffSince: string | null;
  assignedTo: string | null;
  lastMessageAt: string | null;
  lastCustomerMessageAt: string | null;
};

/** Can staff type to this customer now? WhatsApp allows free replies for 24 h after their last message. */
export function replyWindow(lastCustomerMessageAt: string | null, now: number = Date.now()): { open: boolean; hoursLeft: number; minutesLeft: number } {
  if (!lastCustomerMessageAt) return { open: false, hoursLeft: 0, minutesLeft: 0 };
  const left = Date.parse(lastCustomerMessageAt) + WINDOW_MS - now;
  if (!(left > 0)) return { open: false, hoursLeft: 0, minutesLeft: 0 };
  return { open: true, hoursLeft: Math.floor(left / 3600_000), minutesLeft: Math.floor(left / 60_000) };
}

/** "You can reply for 18 more hours" / "…for 25 more minutes" / closed text. */
export function windowLabel(lastCustomerMessageAt: string | null, now: number = Date.now()): string {
  const w = replyWindow(lastCustomerMessageAt, now);
  if (!w.open) return "Customer must message first to reopen the chat";
  if (w.hoursLeft >= 1) return `You can reply for ${w.hoursLeft} more ${w.hoursLeft === 1 ? "hour" : "hours"}`;
  return `You can reply for ${Math.max(1, w.minutesLeft)} more ${w.minutesLeft === 1 ? "minute" : "minutes"}`;
}

export type InboxFilter = "needs_staff" | "all" | "bot" | "mine" | "resolved";

export function matchesFilter(c: ConversationState, filter: InboxFilter, userId: string): boolean {
  switch (filter) {
    case "needs_staff":
      return c.status === "open" && c.needsStaff;
    case "bot":
      return c.status === "open" && c.botEnabled && !c.needsStaff;
    case "mine":
      return c.status === "open" && c.assignedTo === userId;
    case "resolved":
      return c.status === "resolved";
    default:
      return true;
  }
}

/** Default tab: "Needs staff" when any chat needs staff, else "All". */
export function defaultFilter(conversations: ConversationState[]): InboxFilter {
  return conversations.some((c) => c.status === "open" && c.needsStaff) ? "needs_staff" : "all";
}

/** Minutes a needs-staff chat has been waiting, and whether that's past the alert time (row turns red). */
export function waiting(c: Pick<ConversationState, "needsStaff" | "needsStaffSince">, alertMinutes: number, now: number = Date.now()): { minutes: number; overdue: boolean } | null {
  if (!c.needsStaff || !c.needsStaffSince) return null;
  const minutes = Math.max(0, Math.floor((now - Date.parse(c.needsStaffSince)) / 60_000));
  return { minutes, overdue: minutes >= alertMinutes };
}

/** Should this chat be auto-resolved (staff-handled, quiet for `hours`)? Mirrors the SQL. */
export function shouldAutoResolve(c: Pick<ConversationState, "status" | "botEnabled" | "lastMessageAt">, hours: number, now: number = Date.now()): boolean {
  return c.status === "open" && !c.botEnabled && !!c.lastMessageAt && Date.parse(c.lastMessageAt) < now - hours * 3600_000;
}

/** Who answers the next customer message? */
export function whoReplies(c: Pick<ConversationState, "status" | "botEnabled">): "bot" | "staff" {
  return c.status === "resolved" || c.botEnabled ? "bot" : "staff";
}

export type QuickReply = { id: string; shortcut: string; text: string };

/** "/ti" → "/time" first (shortcut prefix), then anything whose shortcut or text contains the words. */
export function searchQuickReplies(list: QuickReply[], query: string, limit = 8): QuickReply[] {
  const shortcutOnly = query.trim().startsWith("/");
  const q = query.trim().toLowerCase().replace(/^\//, "");
  if (!q) return list.slice(0, limit);
  const words = q.split(/\s+/).filter((w) => w.length >= 3);
  const scored = list
    .map((r) => {
      const sc = r.shortcut.toLowerCase().replace(/^\//, "");
      const text = r.text.toLowerCase();
      const inText = !shortcutOnly && words.length > 0 && words.every((w) => text.includes(w));
      const score = sc === q ? 3 : sc.startsWith(q) ? 2 : sc.includes(q) || inText ? 1 : 0;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.r);
}

/** Initials for avatars ("Bilal Hussain" → "BH"). */
export function initials(name: string | null | undefined, fallback = "?"): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") : fallback;
}
