import { z } from "zod";
import type { Database, Json } from "@/types/database";

export type WaMessageType = Database["public"]["Enums"]["wa_message_type"];
export type WaMessageStatus = Database["public"]["Enums"]["wa_message_status"];

/**
 * Meta webhook payload (only the fields we use; everything else passes
 * through untouched in `raw`). Parsing is lenient: one odd message must
 * never stop the others in the same delivery.
 */
const messageSchema = z.looseObject({
  from: z.string(),
  id: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.looseObject({ body: z.string() }).optional(),
  image: z.looseObject({ id: z.string().optional(), caption: z.string().optional() }).optional(),
  audio: z.looseObject({ id: z.string().optional() }).optional(),
  video: z.looseObject({ id: z.string().optional(), caption: z.string().optional() }).optional(),
  sticker: z.looseObject({ id: z.string().optional() }).optional(),
  document: z
    .looseObject({ id: z.string().optional(), caption: z.string().optional(), filename: z.string().optional() })
    .optional(),
  location: z
    .looseObject({
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  interactive: z
    .looseObject({
      type: z.string().optional(),
      button_reply: z.looseObject({ id: z.string().optional(), title: z.string().optional() }).optional(),
      list_reply: z.looseObject({ id: z.string().optional(), title: z.string().optional() }).optional(),
    })
    .optional(),
  button: z.looseObject({ text: z.string().optional(), payload: z.string().optional() }).optional(),
});

const statusSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  timestamp: z.string().optional(),
  recipient_id: z.string().optional(),
  errors: z
    .array(
      z.looseObject({
        code: z.number().optional(),
        title: z.string().optional(),
        message: z.string().optional(),
        error_data: z.looseObject({ details: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const valueSchema = z.looseObject({
  metadata: z.looseObject({ phone_number_id: z.string(), display_phone_number: z.string().optional() }),
  contacts: z
    .array(z.looseObject({ wa_id: z.string().optional(), profile: z.looseObject({ name: z.string().optional() }).optional() }))
    .optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

const payloadSchema = z.looseObject({
  object: z.string().optional(),
  entry: z
    .array(
      z.looseObject({
        id: z.string().optional(),
        changes: z.array(z.looseObject({ field: z.string().optional(), value: z.unknown() })).optional(),
      }),
    )
    .optional(),
});

export type InboundMessage = {
  phoneNumberId: string;
  waId: string;
  profileName: string | null;
  waMessageId: string;
  type: WaMessageType;
  body: string | null;
  mediaId: string | null;
  sentAt: string;
  raw: Json;
};

export type StatusUpdate = {
  phoneNumberId: string;
  waMessageId: string;
  status: Exclude<WaMessageStatus, "received" | "skipped">;
  error: string | null;
  raw: Json;
};

export type ParsedWebhook = {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  /** Items we could not understand (logged on the webhook event row). */
  problems: string[];
};

function toIso(timestamp: string | undefined): string {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

function describeMessage(m: z.infer<typeof messageSchema>): { type: WaMessageType; body: string | null; mediaId: string | null } {
  switch (m.type) {
    case "text":
      return { type: "text", body: m.text?.body ?? null, mediaId: null };
    case "image":
      return { type: "image", body: m.image?.caption ?? null, mediaId: m.image?.id ?? null };
    case "audio":
      return { type: "audio", body: null, mediaId: m.audio?.id ?? null };
    case "document":
      return { type: "document", body: m.document?.caption ?? m.document?.filename ?? null, mediaId: m.document?.id ?? null };
    case "location": {
      const l = m.location;
      const place = [l?.name, l?.address].filter(Boolean).join(", ");
      const coords = l?.latitude !== undefined && l?.longitude !== undefined ? `${l.latitude}, ${l.longitude}` : "";
      return { type: "location", body: [place, coords].filter(Boolean).join(" · ") || null, mediaId: null };
    }
    case "interactive":
      return {
        type: "interactive",
        body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null,
        mediaId: null,
      };
    case "button":
      return { type: "button", body: m.button?.text ?? m.button?.payload ?? null, mediaId: null };
    case "video":
      return { type: "unknown", body: m.video?.caption ?? "[video]", mediaId: m.video?.id ?? null };
    case "sticker":
      return { type: "unknown", body: "[sticker]", mediaId: m.sticker?.id ?? null };
    default:
      return { type: "unknown", body: `[${m.type}]`, mediaId: null };
  }
}

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

export function parseWebhookPayload(input: unknown): ParsedWebhook {
  const result: ParsedWebhook = { messages: [], statuses: [], problems: [] };
  const payload = payloadSchema.safeParse(input);
  if (!payload.success) {
    result.problems.push("Payload is not a WhatsApp webhook");
    return result;
  }
  for (const entry of payload.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success) {
        result.problems.push("Change without metadata.phone_number_id");
        continue;
      }
      const phoneNumberId = value.data.metadata.phone_number_id;
      const names = new Map(
        (value.data.contacts ?? []).filter((c) => c.wa_id).map((c) => [c.wa_id!, c.profile?.name?.trim() || null]),
      );

      for (const rawMessage of value.data.messages ?? []) {
        const m = messageSchema.safeParse(rawMessage);
        if (!m.success) {
          result.problems.push("Unreadable message skipped");
          continue;
        }
        const waId = m.data.from.replace(/\D/g, "");
        result.messages.push({
          phoneNumberId,
          waId,
          profileName: names.get(m.data.from) ?? names.get(waId) ?? null,
          waMessageId: m.data.id,
          ...describeMessage(m.data),
          sentAt: toIso(m.data.timestamp),
          raw: rawMessage as Json,
        });
      }

      for (const rawStatus of value.data.statuses ?? []) {
        const s = statusSchema.safeParse(rawStatus);
        if (!s.success || !STATUSES.has(s.data.status)) {
          result.problems.push(`Unknown status skipped`);
          continue;
        }
        const err = s.data.errors?.[0];
        result.statuses.push({
          phoneNumberId,
          waMessageId: s.data.id,
          status: s.data.status as StatusUpdate["status"],
          error: err
            ? [err.code, err.title, err.message ?? err.error_data?.details].filter(Boolean).join(" · ").slice(0, 1000)
            : null,
          raw: rawStatus as Json,
        });
      }
    }
  }
  return result;
}
