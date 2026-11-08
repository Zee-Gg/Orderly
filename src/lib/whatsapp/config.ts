/**
 * WhatsApp Business Cloud API settings. Change the Graph API version HERE only.
 * (Meta keeps each version for ~2 years; check the changelog when upgrading.)
 */
export const GRAPH_API_VERSION = "v26.0";

/**
 * Normally graph.facebook.com. The e2e tests point WHATSAPP_GRAPH_BASE_URL at a
 * local mock server so no real messages are sent. Never set it in production.
 */
const GRAPH_HOST = (process.env.WHATSAPP_GRAPH_BASE_URL || "https://graph.facebook.com").replace(/\/+$/, "");
export const GRAPH_API_BASE = `${GRAPH_HOST}/${GRAPH_API_VERSION}`;

/**
 * No WhatsApp templates in this version: free-form messages may ONLY be sent
 * within 24h of the customer's last message. Outside it they are skipped and logged.
 */
export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The temporary greeting is sent at most once per conversation in this time. */
export const AUTO_REPLY_COOLDOWN_HOURS = 6;

/** Sends retry (after the first try) on network errors and 5xx. */
export const SEND_MAX_RETRIES = 3;

/** Biggest customer media file we download (WhatsApp's own limit for most media). */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/** Storage bucket for customer media: {restaurant_id}/{message_id}.{ext} (private). */
export const MEDIA_BUCKET = "whatsapp-media";

/** Signed URLs for media in the inbox expire after this many seconds. */
export const MEDIA_URL_TTL_SECONDS = 60 * 60;
