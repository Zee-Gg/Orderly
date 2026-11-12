"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  FileText,
  Hand,
  ImagePlus,
  Link2,
  MapPin,
  Phone,
  RotateCcw,
  Send,
  Smile,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { compressMenuImage } from "@/lib/bot/media-upload";
import {
  assignAction,
  handBackAction,
  resolveAction,
  retryMessageAction,
  sendImageAction,
  sendLocationAction,
  sendMenuAction,
  sendMenuLinkAction,
  sendTextAction,
  setTagsAction,
  takeOverAction,
} from "@/lib/inbox/actions";
import type { ConversationDetail, InboxMessage, StaffMember } from "@/lib/inbox/queries";
import { initials, replyWindow, searchQuickReplies, windowLabel, type QuickReply } from "@/lib/inbox/rules";
import { formatPhone } from "@/lib/orders/phone";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CustomerPanel } from "./customer-panel";

const EMOJIS = ["🙏", "😊", "👍", "🙂", "✅", "🛵", "⏰", "📍", "🍕", "🍔", "❤️", "😔"];
const CHAT_TAGS = ["Complaint", "Late order", "Refund", "VIP", "Question"];

type Result = { ok: boolean; error?: string; message?: string };

export function ChatView({
  detail,
  staff,
  userId,
  timezone,
  now,
  quickReplies,
  canReply,
  canToggleBot,
  onBack,
  onChanged,
}: {
  detail: ConversationDetail;
  staff: StaffMember[];
  userId: string;
  timezone: string;
  now: number;
  quickReplies: QuickReply[];
  canReply: boolean;
  canToggleBot: boolean;
  onBack: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const c = detail.conversation;
  const [pending, start] = useTransition();
  const [showCustomer, setShowCustomer] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const replyWin = replyWindow(c.lastCustomerMessageAt, now);
  const staffChatting = !c.botEnabled && c.status === "open";

  // Stay at the newest message.
  const lastId = detail.messages.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  function run(fn: () => Promise<Result>) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast({ title: r.error ?? "Something went wrong", tone: "error" });
      else if (r.message) toast({ title: r.message });
      await onChanged();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
        <button type="button" onClick={onBack} aria-label="Back to chats" className="flex size-touch items-center justify-center lg:hidden">
          <ArrowLeft aria-hidden className="size-6" />
        </button>
        <button type="button" onClick={() => setShowCustomer(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left xl:pointer-events-none">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800" aria-hidden>
            {initials(c.name, "#")}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-lg font-bold">{c.name || formatPhone(c.phone)}</span>
            <span className="block text-sm text-muted">{formatPhone(c.phone)}</span>
          </span>
        </button>
        {c.phone ? (
          <a href={`tel:${c.phone}`} aria-label="Call customer" className="flex size-touch items-center justify-center rounded-control border border-line-strong">
            <Phone aria-hidden className="size-5" />
          </a>
        ) : null}
      </header>

      {/* Who is answering */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 border-b px-3 py-2",
          c.needsStaff ? "border-status-cancelled-border bg-status-cancelled-bg" : staffChatting ? "border-status-accepted-border bg-status-accepted-bg" : "border-brand-200 bg-brand-50",
        )}
        data-testid="chat-mode"
      >
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-white", c.needsStaff ? "bg-danger" : staffChatting ? "bg-status-accepted-fg" : "bg-brand-700")}>
          {staffChatting ? <UserRound aria-hidden className="size-5" /> : <Bot aria-hidden className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {c.status === "resolved"
              ? "Resolved — the bot answers the next message"
              : c.needsStaff
                ? `Needs staff${c.handoffReason ? `: ${c.handoffReason}` : ""}`
                : staffChatting
                  ? "👤 You are chatting — the bot is paused"
                  : "🤖 Bot is handling this chat"}
          </p>
          <p className="text-sm text-muted">{staffChatting || c.needsStaff ? "The bot stays quiet until you hand it back." : "You can read along. Take over to reply yourself."}</p>
        </div>
        {canToggleBot ? (
          staffChatting || c.needsStaff ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => handBackAction(c.id))}
              className="flex min-h-touch items-center gap-2 rounded-control border-2 border-ink bg-surface px-3 font-bold"
            >
              <Bot aria-hidden className="size-5" /> Hand back to bot
            </button>
          ) : c.status === "open" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => takeOverAction(c.id))}
              className="flex min-h-touch items-center gap-2 rounded-control bg-ink px-4 font-bold text-white"
            >
              <Hand aria-hidden className="size-5" /> Take over
            </button>
          ) : null
        ) : null}
      </div>

      {/* Assign · Resolve · Tags */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-muted">Assign:</span>
          <select
            value={c.assignedTo ?? ""}
            onChange={(e) => run(() => assignAction({ conversationId: c.id, userId: e.target.value || null }))}
            disabled={pending}
            className="min-h-touch rounded-control border border-line-strong bg-surface px-2"
            data-testid="assign-staff"
          >
            <option value="">Nobody</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === userId ? `${s.name} (me)` : s.name}
              </option>
            ))}
          </select>
        </label>
        <TagPicker tags={c.tags} onChange={(tags) => run(() => setTagsAction({ conversationId: c.id, tags }))} />
        <span className="flex-1" />
        {canToggleBot && c.status === "open" ? (
          <button type="button" disabled={pending} onClick={() => run(() => resolveAction(c.id))} className="flex min-h-touch items-center gap-1 rounded-control border border-line-strong px-3 font-semibold">
            <CheckCircle2 aria-hidden className="size-4" /> Resolve
          </button>
        ) : null}
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-page px-3 py-4" data-testid="messages">
        <ol className="flex flex-col gap-2">
          {detail.messages.map((m) => (
            <MessageRow key={m.id} m={m} timezone={timezone} onRetry={() => run(() => retryMessageAction(m.id))} pending={pending} />
          ))}
        </ol>
        <div ref={bottom} />
      </div>

      {/* 24-hour window + composer */}
      <p className={cn("border-t border-line px-3 py-1.5 text-center text-xs font-semibold", replyWin.open ? "text-status-ready-fg" : "bg-status-awaiting-bg text-status-awaiting-fg")} data-testid="window">
        {windowLabel(c.lastCustomerMessageAt, now)}
      </p>
      {canReply ? (
        <Composer
          conversationId={c.id}
          disabled={!replyWin.open}
          takesOver={!staffChatting}
          quickReplies={quickReplies}
          onSent={onChanged}
        />
      ) : null}

      {/* Customer panel on smaller screens */}
      {showCustomer ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 xl:hidden" onClick={() => setShowCustomer(false)}>
          <div className="h-full w-full max-w-sm overflow-y-auto bg-surface" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end p-2">
              <button type="button" onClick={() => setShowCustomer(false)} aria-label="Close" className="flex size-touch items-center justify-center">
                <X aria-hidden className="size-6" />
              </button>
            </div>
            <CustomerPanel detail={detail} onChanged={onChanged} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TagPicker({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Chat tags">
      {CHAT_TAGS.map((t) => {
        const on = tags.includes(t);
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? tags.filter((x) => x !== t) : [...tags, t])}
            className={cn("min-h-8 rounded-full border px-2 text-xs font-semibold", on ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line text-muted")}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

function Ticks({ status }: { status: string }) {
  if (status === "read") return <CheckCheck aria-label="Read" className="size-4 text-status-accepted-fg" />;
  if (status === "delivered") return <CheckCheck aria-label="Delivered" className="size-4 text-muted" />;
  if (status === "sent") return <Check aria-label="Sent" className="size-4 text-muted" />;
  return null;
}

function MessageRow({ m, timezone, onRetry, pending }: { m: InboxMessage; timezone: string; onRetry: () => void; pending: boolean }) {
  const time = formatClock(m.createdAt, timezone);
  if (m.systemLine) {
    // Grey line, never sent to WhatsApp ("Handed to staff…", "Bot turned back on by Ali", "Order #1045 created").
    return (
      <li className="self-center rounded-full bg-subtle px-3 py-1 text-center text-xs font-semibold text-muted" data-testid="system-line">
        {m.body} · {time}
      </li>
    );
  }
  const inbound = m.direction === "inbound";
  const label =
    inbound ? null : m.senderType === "staff" ? `👤 ${m.senderName ?? "Staff"}` : m.senderType === "system" ? "🔔 Order update" : "🤖 Bot";
  return (
    <li className={cn("flex max-w-[85%] flex-col gap-1", inbound ? "self-start" : "self-end items-end")} data-testid="message" data-sender={m.senderType}>
      <div
        className={cn(
          "rounded-card px-3 py-2 shadow-card",
          inbound ? "bg-surface" : m.senderType === "staff" ? "bg-status-ready-bg" : m.senderType === "system" ? "bg-subtle" : "bg-brand-50",
          m.status === "failed" && "border-2 border-danger",
          m.status === "skipped" && "opacity-60",
        )}
      >
        {label ? <p className="mb-1 text-xs font-bold text-brand-800">{label}</p> : null}
        <MessageBody m={m} />
        {m.buttons.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.buttons.map((b, i) => (
              <span key={i} className={cn("rounded-control border px-3 py-1 text-sm font-semibold", inbound ? "border-whatsapp bg-status-ready-bg" : "border-brand-200 bg-surface text-brand-700")}>
                {inbound ? `Tapped: ${b}` : b}
              </span>
            ))}
          </div>
        ) : null}
        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted">
          {time} {!inbound ? <Ticks status={m.status} /> : null}
        </p>
      </div>
      {m.status === "failed" ? (
        <p className="flex items-center gap-2 text-xs text-danger">
          <AlertTriangle aria-hidden className="size-4" /> Not delivered{m.error ? ` · ${m.error.slice(0, 80)}` : ""}
          {m.retryable ? (
            <button type="button" disabled={pending} onClick={onRetry} className="inline-flex min-h-8 items-center gap-1 rounded-control border border-danger px-2 font-semibold">
              <RotateCcw aria-hidden className="size-3" /> Retry
            </button>
          ) : null}
        </p>
      ) : m.status === "skipped" ? (
        <p className="text-xs text-muted">Not sent — outside the 24-hour window</p>
      ) : null}
    </li>
  );
}

function MessageBody({ m }: { m: InboxMessage }): ReactNode {
  if (m.type === "audio") {
    return (
      <div className="flex flex-col gap-1">
        {m.mediaUrl ? <audio controls src={m.mediaUrl} className="h-11 w-64 max-w-full" aria-label="Voice note" /> : <p className="text-sm text-muted">🎤 Voice note</p>}
        {m.transcript ? (
          <p dir="auto" className="text-sm">
            <span className="mr-1 text-xs font-semibold text-muted">🎤 transcript:</span>
            {m.transcript}
          </p>
        ) : null}
      </div>
    );
  }
  if (m.type === "image") {
    return (
      <div className="flex flex-col gap-1">
        {m.mediaUrl ? (
          <a href={m.mediaUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed / public media URL */}
            <img src={m.mediaUrl} alt="Photo" className="max-h-64 rounded-control object-cover" loading="lazy" />
          </a>
        ) : (
          <p className="text-sm text-muted">📷 Photo</p>
        )}
        {m.body && !m.body.startsWith("[") ? <p dir="auto" className="whitespace-pre-wrap">{m.body}</p> : null}
      </div>
    );
  }
  if (m.type === "document") {
    return (
      <a href={m.mediaUrl ?? undefined} target="_blank" rel="noreferrer" className="flex min-h-touch items-center gap-2 font-semibold text-brand-700 underline">
        <FileText aria-hidden className="size-5" /> {m.body?.split("\n")[0] || "Document"}
      </a>
    );
  }
  if (m.type === "location") {
    const loc = m.location;
    const q = loc ? `${loc.latitude},${loc.longitude}` : null;
    return (
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-1 font-semibold">
          <MapPin aria-hidden className="size-4 text-brand-700" /> Location
        </p>
        <p dir="auto" className="text-sm">{loc ? [loc.name, loc.address].filter(Boolean).join(" · ") || q : m.body}</p>
        {q ? (
          <a href={`https://www.google.com/maps?q=${q}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-700 underline">
            Open in Maps
          </a>
        ) : null}
      </div>
    );
  }
  return (
    <p dir="auto" className="whitespace-pre-wrap break-words">
      {m.body}
    </p>
  );
}

function Composer({
  conversationId,
  disabled,
  takesOver,
  quickReplies,
  onSent,
}: {
  conversationId: string;
  disabled: boolean;
  takesOver: boolean;
  quickReplies: QuickReply[];
  onSent: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [showReplies, setShowReplies] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const slash = text.startsWith("/") && !text.includes(" ") ? text : null;
  const matches = slash !== null || showReplies ? searchQuickReplies(quickReplies, slash ?? "", 8) : [];

  function act(fn: () => Promise<Result>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast({ title: r.error ?? "Not sent", tone: "error" });
      else after?.();
      await onSent();
    });
  }

  function send() {
    const body = text.trim();
    if (!body || disabled) return;
    act(() => sendTextAction({ conversationId, text: body }), () => setText(""));
  }

  function pickReply(r: QuickReply) {
    setText(r.text);
    setShowReplies(false);
    area.current?.focus();
  }

  async function sendPhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    start(async () => {
      try {
        const blob = await compressMenuImage(file);
        const form = new FormData();
        form.append("file", new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" }));
        const res = await fetch("/api/inbox/upload", { method: "POST", body: form });
        const body = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !body.url) throw new Error(body.error ?? "Upload failed");
        const r = await sendImageAction({ conversationId, url: body.url, caption: text.trim() });
        if (!r.ok) throw new Error(r.error);
        setText("");
      } catch (err) {
        toast({ title: err instanceof Error ? err.message : "Couldn't send the photo", tone: "error" });
      } finally {
        if (fileRef.current) fileRef.current.value = "";
        await onSent();
      }
    });
  }

  const tool = "flex size-touch shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface disabled:opacity-40";

  return (
    <div className="relative border-t border-line bg-surface p-2" data-testid="composer">
      {matches.length ? (
        <ul className="absolute bottom-full left-2 right-2 mb-1 max-h-64 overflow-y-auto rounded-card border border-line bg-surface shadow-raised" role="listbox" aria-label="Quick replies">
          {matches.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => pickReply(r)} className="flex min-h-touch w-full flex-col items-start px-3 py-2 text-left hover:bg-subtle" role="option" aria-selected="false">
                <span className="text-sm font-bold text-brand-700">{r.shortcut}</span>
                <span className="line-clamp-1 text-sm text-muted">{r.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showEmoji ? (
        <div className="absolute bottom-full left-2 mb-1 flex flex-wrap gap-1 rounded-card border border-line bg-surface p-2 shadow-raised">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="size-touch text-xl"
              onClick={() => {
                setText((t) => t + e);
                setShowEmoji(false);
                area.current?.focus();
              }}
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}

      {!disabled && quickReplies.length ? (
        <div className="mb-2 flex gap-1.5 overflow-x-auto">
          {quickReplies.slice(0, 4).map((r) => (
            <button key={r.id} type="button" onClick={() => pickReply(r)} className="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-sm font-semibold">
              {r.text.split(/[.!?]/)[0].slice(0, 32)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-1.5">
        <button type="button" className={tool} aria-label="Quick replies" disabled={disabled} onClick={() => setShowReplies((v) => !v)}>
          <Zap aria-hidden className="size-5" />
        </button>
        <button type="button" className={tool} aria-label="Send photo" disabled={disabled || pending} onClick={() => fileRef.current?.click()}>
          <ImagePlus aria-hidden className="size-5" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => void sendPhoto(e.target.files)} data-testid="photo-input" />
        <button type="button" className={tool} aria-label="Send menu" disabled={disabled || pending} onClick={() => act(() => sendMenuAction(conversationId))}>
          <BookOpen aria-hidden className="size-5" />
        </button>
        <button type="button" className={cn(tool, "hidden sm:flex")} aria-label="Send menu link" disabled={disabled || pending} onClick={() => act(() => sendMenuLinkAction(conversationId))}>
          <Link2 aria-hidden className="size-5" />
        </button>
        <button type="button" className={tool} aria-label="Send location" disabled={disabled || pending} onClick={() => act(() => sendLocationAction(conversationId))}>
          <MapPin aria-hidden className="size-5" />
        </button>
        <div className="flex min-h-touch flex-1 items-end rounded-[22px] border border-line-strong bg-surface px-2">
          <button type="button" className="flex size-10 shrink-0 items-center justify-center" aria-label="Emoji" disabled={disabled} onClick={() => setShowEmoji((v) => !v)}>
            <Smile aria-hidden className="size-5 text-muted" />
          </button>
          <textarea
            ref={area}
            value={text}
            disabled={disabled}
            rows={1}
            maxLength={4096}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowReplies(false);
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (slash && matches[0]) pickReply(matches[0]);
                else send();
              }
            }}
            placeholder={disabled ? "Customer must message first" : takesOver ? "Type a message — this takes over from the bot" : "Type a message ( / for quick replies)"}
            aria-label="Message"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2.5 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={send}
          disabled={disabled || pending || !text.trim()}
          aria-label="Send"
          className="flex size-touch-lg shrink-0 items-center justify-center rounded-full bg-whatsapp text-white disabled:bg-line disabled:text-muted"
        >
          <Send aria-hidden className="size-5" />
        </button>
      </div>
    </div>
  );
}
