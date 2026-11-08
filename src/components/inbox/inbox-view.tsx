"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Image as ImageIcon,
  MapPin,
  MessageCircle,
  ShoppingBag,
  Mic,
  Wifi,
  WifiOff,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPhone } from "@/lib/orders/phone";
import { useLiveRefresh } from "@/lib/realtime/use-live-refresh";
import { formatClock, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { InboxConversation, InboxMessage } from "@/lib/whatsapp/queries";

const URDU = /[؀-ۿ]/;

function displayName(c: InboxConversation) {
  return c.name || formatPhone(c.phone ?? `+${c.waId}`) || `+${c.waId}`;
}

const TYPE_LABEL: Record<string, { icon: typeof Mic; label: string }> = {
  image: { icon: ImageIcon, label: "Photo" },
  audio: { icon: Mic, label: "Voice note" },
  document: { icon: FileText, label: "Document" },
  location: { icon: MapPin, label: "Location" },
};

export function InboxView({
  restaurantId,
  timezone,
  conversations,
  selected,
  messages,
}: {
  restaurantId: string;
  timezone: string;
  conversations: InboxConversation[];
  selected: InboxConversation | null;
  messages: InboxMessage[];
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const { realtime } = useLiveRefresh({
    table: "whatsapp_messages",
    filter: `restaurant_id=eq.${restaurantId}`,
    refresh,
  });

  if (conversations.length === 0) {
    return (
      <EmptyState
        tone="brand"
        icon={<MessageCircle />}
        title="No chats yet"
        description="When customers message your WhatsApp number, their chats show here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        {realtime === "live" ? <Wifi aria-hidden className="size-3.5 text-whatsapp" /> : <WifiOff aria-hidden className="size-3.5" />}
        {realtime === "live" ? "Live" : realtime === "connecting" ? "Connecting…" : "Updating every 20 seconds"}
      </p>
      <div className="grid overflow-hidden rounded-card border border-line bg-surface lg:h-[calc(100dvh-14rem)] lg:grid-cols-[340px_1fr]">
        <ul
          aria-label="Chats"
          className={cn("divide-y divide-line overflow-y-auto lg:border-r lg:border-line", selected && "hidden lg:block")}
        >
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/inbox?c=${c.id}`}
                aria-current={selected?.id === c.id ? "true" : undefined}
                className={cn(
                  "flex min-h-touch-lg flex-col gap-0.5 px-4 py-3 hover:bg-subtle",
                  selected?.id === c.id && "bg-brand-50",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{displayName(c)}</span>
                  {c.lastMessageAt ? <span className="shrink-0 text-xs text-muted">{timeAgo(c.lastMessageAt)}</span> : null}
                </span>
                {c.name && c.phone ? <span className="text-xs text-muted">{formatPhone(c.phone)}</span> : null}
                <span dir="auto" className={cn("truncate text-sm text-muted", c.preview && URDU.test(c.preview) && "font-urdu")}>
                  {(c.preview ?? "").replace(/\*([^*\n]+)\*/g, "$1")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {selected ? (
          <Thread conversation={selected} messages={messages} timezone={timezone} />
        ) : (
          <div className="hidden items-center justify-center p-8 text-muted lg:flex">Choose a chat to read it.</div>
        )}
      </div>
    </div>
  );
}

function Thread({
  conversation,
  messages,
  timezone,
}: {
  conversation: InboxConversation;
  messages: InboxMessage[];
  timezone: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  return (
    <section aria-label={`Chat with ${displayName(conversation)}`} className="flex min-h-[60dvh] flex-col lg:min-h-0">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2 lg:px-4">
        <Link href="/inbox" className="flex size-touch items-center justify-center rounded-control hover:bg-subtle lg:hidden" aria-label="Back to chats">
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{displayName(conversation)}</p>
          <p className="text-xs text-muted">{formatPhone(conversation.phone ?? `+${conversation.waId}`) || `+${conversation.waId}`}</p>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-subtle/50 p-3 lg:p-4">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} timezone={timezone} />
        ))}
        <div ref={end} />
      </div>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        Read only for now. Replying from Orderly is coming soon.
      </p>
    </section>
  );
}

function Bubble({ message: m, timezone }: { message: InboxMessage; timezone: string }) {
  const outbound = m.direction === "outbound";
  const kind = TYPE_LABEL[m.type];
  const Icon = kind?.icon;
  const urdu = m.body ? URDU.test(m.body) : false;
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")} data-direction={m.direction}>
      <div
        className={cn(
          "max-w-[85%] rounded-card px-3 py-2 shadow-card",
          outbound ? "bg-status-ready-bg text-ink" : "bg-surface text-ink",
          (m.status === "failed" || m.status === "skipped") && "opacity-80 ring-1 ring-status-cancelled-border",
        )}
      >
        {m.orderId ? (
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <ShoppingBag aria-hidden className="size-3.5" /> Order update
          </p>
        ) : null}
        {m.mediaUrl && (m.type === "image" || m.type === "audio" || m.type === "document") ? (
          <Media message={m} />
        ) : kind && Icon ? (
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-muted">
            <Icon aria-hidden className="size-4" /> {kind.label}
          </p>
        ) : null}
        {m.body ? (
          <p dir="auto" className={cn("whitespace-pre-wrap wrap-break-word", urdu && "font-urdu leading-loose")}>
            {withBold(m.body)}
          </p>
        ) : null}
        <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted">
          {formatClock(m.createdAt, timezone)}
          {outbound ? <StatusTick status={m.status} /> : null}
        </p>
        {m.status === "failed" || m.status === "skipped" ? (
          <p className="mt-1 flex items-start gap-1 text-xs font-semibold text-danger">
            <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {m.status === "skipped" ? "Not sent" : "Failed"}
            {m.error ? `: ${m.error}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Photo / voice note / document. Signed URLs change on every refresh, so keep
 * the first one (no re-download on weak internet) and only switch to the new
 * one if the old link has expired (load error).
 */
function Media({ message: m }: { message: InboxMessage }) {
  const [src, setSrc] = useState(m.mediaUrl!);
  const retry = () => {
    if (m.mediaUrl && m.mediaUrl !== src) setSrc(m.mediaUrl);
  };
  if (m.type === "image") {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 block" aria-label="Open photo">
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not for next/image */}
        <img src={src} onError={retry} alt="Photo from the chat" loading="lazy" className="max-h-72 w-auto max-w-full rounded-control object-contain" />
      </a>
    );
  }
  if (m.type === "audio") {
    return (
      <div className="mb-1 flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-muted">
          <Mic aria-hidden className="size-4" /> Voice note
        </p>
        <audio controls preload="none" src={src} onError={retry} className="h-11 w-64 max-w-full" aria-label="Voice note" />
      </div>
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 flex min-h-touch items-center gap-2 rounded-control border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-subtle"
    >
      <FileText aria-hidden className="size-5 shrink-0" /> Open document
    </a>
  );
}

/** WhatsApp formatting: *bold* → bold (text stays plain React text, no HTML). */
function withBold(text: string) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    part.length > 2 && part.startsWith("*") && part.endsWith("*") ? <strong key={i}>{part.slice(1, -1)}</strong> : part,
  );
}

function StatusTick({ status }: { status: string }) {
  if (status === "read") return <CheckCheck aria-label="Read" className="size-4 text-status-accepted-fg" />;
  if (status === "delivered") return <CheckCheck aria-label="Delivered" className="size-4" />;
  if (status === "sent") return <Check aria-label="Sent" className="size-4" />;
  if (status === "failed" || status === "skipped") return <AlertCircle aria-label={status} className="size-4 text-danger" />;
  return <Clock aria-label={status} className="size-4" />;
}
