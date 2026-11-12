"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, MessageCircle, Search, UserRound } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { fetchConversationAction, fetchInboxAction, markReadAction } from "@/lib/inbox/actions";
import type { ConversationDetail, InboxConversation, InboxSettings, StaffMember } from "@/lib/inbox/queries";
import { defaultFilter, initials, matchesFilter, waiting, type InboxFilter, type QuickReply } from "@/lib/inbox/rules";
import { formatPhone } from "@/lib/orders/phone";
import { useLiveRefresh } from "@/lib/realtime/use-live-refresh";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ChatView } from "./chat-view";
import { CustomerPanel } from "./customer-panel";

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: "needs_staff", label: "Needs staff" },
  { key: "all", label: "All" },
  { key: "bot", label: "Bot handling" },
  { key: "mine", label: "Mine" },
  { key: "resolved", label: "Resolved" },
];

/**
 * WhatsApp inbox (Phase 10). Desktop: conversations | chat | customer.
 * Mobile: the list, then a full-screen chat. Live: realtime on conversations,
 * messages and notes (RLS: front of house of this restaurant) + polling.
 */
export function InboxApp({
  restaurantId,
  userId,
  timezone,
  initialConversations,
  initialDetail,
  staff: initialStaff,
  settings: initialSettings,
  quickReplies,
  canReply,
  canToggleBot,
}: {
  restaurantId: string;
  userId: string;
  timezone: string;
  initialConversations: InboxConversation[];
  initialDetail: ConversationDetail | null;
  staff: StaffMember[];
  settings: InboxSettings;
  quickReplies: QuickReply[];
  canReply: boolean;
  canToggleBot: boolean;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [staff, setStaff] = useState(initialStaff);
  const [settings, setSettings] = useState(initialSettings);
  const [filter, setFilter] = useState<InboxFilter>(() => defaultFilter(initialConversations));
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialDetail?.conversation.id ?? null);
  const [detail, setDetail] = useState<ConversationDetail | null>(initialDetail);
  const [now, setNow] = useState(() => Date.now());
  const searchRef = useRef(search);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    searchRef.current = search;
    selectedRef.current = selectedId;
  });

  // Clock for "waiting 5 min" and the 24-hour window.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refreshList = useCallback(async () => {
    const r = await fetchInboxAction(searchRef.current);
    if (!r) return;
    setConversations(r.conversations);
    setStaff(r.staff);
    setSettings(r.settings);
  }, []);

  const refreshChat = useCallback(async () => {
    const id = selectedRef.current;
    if (!id) return;
    const d = await fetchConversationAction(id);
    if (d && selectedRef.current === id) setDetail(d);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshList(), refreshChat()]);
  }, [refreshList, refreshChat]);

  const { realtime } = useLiveRefresh({ table: "whatsapp_conversations", filter: `restaurant_id=eq.${restaurantId}`, refresh: refreshAll });
  useLiveRefresh({ table: "whatsapp_messages", filter: `restaurant_id=eq.${restaurantId}`, refresh: refreshAll });

  // Search (debounced).
  useEffect(() => {
    const id = setTimeout(() => void refreshList(), 300);
    return () => clearTimeout(id);
  }, [search, refreshList]);

  async function open(id: string) {
    setSelectedId(id);
    selectedRef.current = id;
    setDetail((d) => (d?.conversation.id === id ? d : null));
    const url = new URL(window.location.href);
    url.searchParams.set("c", id);
    window.history.replaceState(null, "", url);
    const [d] = await Promise.all([fetchConversationAction(id), markReadAction(id)]);
    if (selectedRef.current === id) setDetail(d);
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
  }

  // Opening a chat from a link (?c=…) marks it read once.
  const markedInitial = useRef(false);
  useEffect(() => {
    if (initialDetail && !markedInitial.current) {
      markedInitial.current = true;
      void markReadAction(initialDetail.conversation.id);
    }
  }, [initialDetail]);

  // New messages in the open chat are read right away.
  const openUnread = conversations.find((c) => c.id === selectedId)?.unreadCount ?? 0;
  useEffect(() => {
    if (selectedId && openUnread > 0 && document.visibilityState === "visible") void markReadAction(selectedId);
  }, [selectedId, openUnread]);

  function close() {
    setSelectedId(null);
    selectedRef.current = null;
    setDetail(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, conversations.filter((c) => matchesFilter(c, f.key, userId)).length])) as Record<InboxFilter, number>,
    [conversations, userId],
  );
  const shown = conversations.filter((c) => matchesFilter(c, filter, userId));
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.name ?? null;

  return (
    <div className="grid gap-0 overflow-hidden rounded-panel border border-line bg-surface lg:h-[calc(100dvh-9.5rem)] lg:grid-cols-[340px_1fr] xl:grid-cols-[340px_1fr_320px]" data-testid="inbox">
      {/* Column 1 — conversations */}
      <section className={cn("flex min-h-0 flex-col border-line lg:border-r", selectedId && "hidden lg:flex")} aria-label="Conversations">
        <div className="flex flex-col gap-3 border-b border-line p-3">
          <label className="flex min-h-touch items-center gap-2 rounded-control border border-line-strong px-3">
            <Search aria-hidden className="size-5 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or phone"
              aria-label="Search name or phone"
              className="min-h-touch flex-1 bg-transparent outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter chats">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "flex min-h-touch items-center gap-1.5 rounded-full border px-3 text-sm font-semibold",
                  filter === f.key ? "border-ink bg-ink text-white" : "border-line-strong bg-surface",
                )}
              >
                {f.key === "needs_staff" && counts.needs_staff > 0 ? <span aria-hidden className="size-2 rounded-full bg-danger" /> : null}
                {f.label} {counts[f.key] ? <span className="opacity-80">{counts[f.key]}</span> : null}
              </button>
            ))}
          </div>
          {realtime !== "live" ? <p className="text-xs text-muted">Updating every few seconds…</p> : null}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="conversation-list">
          {shown.length === 0 ? (
            <li className="p-6 text-center text-muted">{filter === "needs_staff" ? "No one is waiting for staff 🎉" : "No chats here."}</li>
          ) : (
            shown.map((c) => {
              const wait = waiting(c, settings.needsStaffAlertMinutes, now);
              const assigned = staffName(c.assignedTo);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void open(c.id)}
                    data-testid="conversation-row"
                    data-conversation={c.id}
                    aria-current={c.id === selectedId ? "true" : undefined}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-line px-3 py-3 text-left hover:bg-subtle",
                      c.id === selectedId && "bg-brand-50",
                      wait?.overdue && "bg-status-cancelled-bg/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-full font-bold",
                        c.needsStaff ? "bg-status-cancelled-bg text-status-cancelled-fg" : "bg-brand-100 text-brand-800",
                      )}
                      aria-hidden
                    >
                      {initials(c.name, "#")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-bold">{c.name || formatPhone(c.phone)}</span>
                        <span className="flex-1" />
                        {wait ? (
                          <span className={cn("shrink-0 text-xs font-bold", wait.overdue ? "text-danger" : "text-status-awaiting-fg")} data-testid="waiting">
                            ● waiting {wait.minutes} min
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs text-muted">{c.lastMessageAt ? timeAgo(c.lastMessageAt, now) : ""}</span>
                        )}
                      </span>
                      {c.name ? <span className="block text-xs text-muted">{formatPhone(c.phone)}</span> : null}
                      <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                        {c.botEnabled ? <Bot aria-label="Bot" className="size-4 shrink-0 text-brand-700" /> : <UserRound aria-label="Staff" className="size-4 shrink-0 text-status-accepted-fg" />}
                        <span className="truncate">{c.needsStaff && c.handoffReason ? `Needs staff: ${c.handoffReason}` : c.preview}</span>
                        <span className="flex-1" />
                        {assigned ? (
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-status-accepted-bg text-[10px] font-bold text-status-accepted-fg" title={`Assigned to ${assigned}`}>
                            {initials(assigned)}
                          </span>
                        ) : null}
                        {c.unreadCount > 0 ? (
                          <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-brand-700 px-1.5 text-xs font-bold text-white" data-testid="unread">
                            {c.unreadCount}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>

      {/* Column 2 — chat (full screen on phones) */}
      <section className={cn("min-h-0 flex-col", selectedId ? "fixed inset-0 z-40 flex bg-page lg:static lg:z-auto" : "hidden lg:flex")} aria-label="Chat">
        {selectedId && detail ? (
          <ChatView
            key={detail.conversation.id}
            detail={detail}
            staff={staff}
            userId={userId}
            timezone={timezone}
            now={now}
            quickReplies={quickReplies}
            canReply={canReply}
            canToggleBot={canToggleBot}
            onBack={close}
            onChanged={refreshAll}
          />
        ) : selectedId ? (
          <p className="m-auto text-muted">Loading chat…</p>
        ) : (
          <div className="m-auto p-6">
            <EmptyState icon={<MessageCircle />} title="Choose a chat" description="Pick a customer on the left to read and reply." />
          </div>
        )}
      </section>

      {/* Column 3 — customer */}
      <aside className="hidden min-h-0 overflow-y-auto border-l border-line xl:block" aria-label="Customer">
        {detail ? <CustomerPanel detail={detail} onChanged={refreshChat} /> : null}
      </aside>
    </div>
  );
}
