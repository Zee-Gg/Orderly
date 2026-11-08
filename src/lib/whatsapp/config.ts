/**
 * WhatsApp Business Cloud API settings. Change the Graph API version HERE only.
 * (Meta keeps each version for ~2 years; check the changelog when upgrading.)
 */
export const GRAPH_API_VERSION = "v26.0";
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Free-form messages may only be sent within 24h of the customer's last message. */
export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The temporary greeting is sent at most once per conversation in this time. */
export const AUTO_REPLY_COOLDOWN_HOURS = 6;

/** sendText retries (after the first try) on network errors and 5xx. */
export const SEND_MAX_RETRIES = 3;
