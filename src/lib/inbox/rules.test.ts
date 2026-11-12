import { describe, expect, it } from "vitest";
import {
  defaultFilter,
  initials,
  matchesFilter,
  replyWindow,
  searchQuickReplies,
  shouldAutoResolve,
  waiting,
  whoReplies,
  windowLabel,
  type ConversationState,
} from "./rules";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600_000;

const conv = (c: Partial<ConversationState> = {}): ConversationState => ({
  status: "open",
  botEnabled: true,
  needsStaff: false,
  needsStaffSince: null,
  assignedTo: null,
  lastMessageAt: ago(60_000),
  lastCustomerMessageAt: ago(60_000),
  ...c,
});

describe("24-hour reply window", () => {
  it("open with hours left, closed after 24 h or with no customer message", () => {
    expect(replyWindow(ago(6 * H), NOW)).toMatchObject({ open: true, hoursLeft: 18 });
    expect(windowLabel(ago(6 * H), NOW)).toBe("You can reply for 18 more hours");
    expect(windowLabel(ago(23.5 * H), NOW)).toBe("You can reply for 30 more minutes");
    expect(replyWindow(ago(24 * H + 1), NOW).open).toBe(false);
    expect(windowLabel(ago(25 * H), NOW)).toBe("Customer must message first to reopen the chat");
    expect(replyWindow(null, NOW).open).toBe(false);
  });
});

describe("bot / staff rules", () => {
  it("bot answers when its switch is on or the chat was resolved; staff otherwise", () => {
    expect(whoReplies({ status: "open", botEnabled: true })).toBe("bot");
    expect(whoReplies({ status: "open", botEnabled: false })).toBe("staff"); // taken over / handed off
    expect(whoReplies({ status: "resolved", botEnabled: false })).toBe("bot"); // resolved chats reopen with the bot
  });

  it("auto-resolve: only staff-handled open chats quiet for the set hours", () => {
    expect(shouldAutoResolve(conv({ botEnabled: false, lastMessageAt: ago(7 * H) }), 6, NOW)).toBe(true);
    expect(shouldAutoResolve(conv({ botEnabled: false, lastMessageAt: ago(5 * H) }), 6, NOW)).toBe(false);
    expect(shouldAutoResolve(conv({ botEnabled: true, lastMessageAt: ago(9 * H) }), 6, NOW)).toBe(false); // bot already on
    expect(shouldAutoResolve(conv({ status: "resolved", botEnabled: false, lastMessageAt: ago(9 * H) }), 6, NOW)).toBe(false);
  });
});

describe("list filters", () => {
  const me = "user-1";
  const list = [
    conv({ needsStaff: true, botEnabled: false, needsStaffSince: ago(5 * 60_000) }),
    conv(),
    conv({ botEnabled: false, assignedTo: me }),
    conv({ status: "resolved" }),
  ];
  it("needs staff / bot / mine / resolved", () => {
    expect(list.filter((c) => matchesFilter(c, "needs_staff", me))).toHaveLength(1);
    expect(list.filter((c) => matchesFilter(c, "bot", me))).toHaveLength(1);
    expect(list.filter((c) => matchesFilter(c, "mine", me))).toHaveLength(1);
    expect(list.filter((c) => matchesFilter(c, "resolved", me))).toHaveLength(1);
    expect(list.filter((c) => matchesFilter(c, "all", me))).toHaveLength(4);
  });
  it("default tab is Needs staff only when a chat needs staff", () => {
    expect(defaultFilter(list)).toBe("needs_staff");
    expect(defaultFilter([conv(), conv({ status: "resolved", needsStaff: true })])).toBe("all");
  });
  it("waiting time turns red after the alert minutes", () => {
    expect(waiting(conv({ needsStaff: true, needsStaffSince: ago(5 * 60_000) }), 3, NOW)).toEqual({ minutes: 5, overdue: true });
    expect(waiting(conv({ needsStaff: true, needsStaffSince: ago(60_000) }), 3, NOW)).toEqual({ minutes: 1, overdue: false });
    expect(waiting(conv(), 3, NOW)).toBeNull();
  });
});

describe("quick replies", () => {
  const replies = [
    { id: "1", shortcut: "/time", text: "Aap ka order 30–40 minute mein" },
    { id: "2", shortcut: "/thanks", text: "Shukriya!" },
    { id: "3", shortcut: "/sorry", text: "Der ke liye maazrat" },
    { id: "4", shortcut: "/call", text: "Hum aap ko call karte hain" },
  ];
  it("shortcut prefix first, then text words", () => {
    expect(searchQuickReplies(replies, "/t").map((r) => r.shortcut)).toEqual(["/time", "/thanks"]);
    expect(searchQuickReplies(replies, "/time").map((r) => r.shortcut)).toEqual(["/time"]);
    expect(searchQuickReplies(replies, "maazrat").map((r) => r.shortcut)).toEqual(["/sorry"]);
    expect(searchQuickReplies(replies, "/").length).toBe(4);
    expect(searchQuickReplies(replies, "/xyz")).toEqual([]);
  });
  it("initials", () => {
    expect(initials("Bilal Hussain")).toBe("BH");
    expect(initials("ali")).toBe("A");
    expect(initials(null)).toBe("?");
  });
});
