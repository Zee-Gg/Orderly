import { GRAPH_API_BASE } from "./config";

/** Thin Graph API calls. No retries here — callers decide. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number | null; retryable: boolean };

/**
 * Meta sometimes echoes the token in error messages ("Malformed access token
 * EAAG..."). Errors are saved and shown to staff, so never keep the token.
 */
export function redactToken(text: string, token: string): string {
  let out = token ? text.split(token).join("[token]") : text;
  out = out.replace(/\bEAA[A-Za-z0-9_-]{8,}/g, "[token]");
  return out;
}

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } };

async function call<T>(fetchImpl: FetchLike, path: string, token: string, init?: RequestInit): Promise<GraphResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(`${GRAPH_API_BASE}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}`, status: null, retryable: true };
  }
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok) {
    const e = json.error;
    const detail = [e?.code, e?.message, e?.error_data?.details].filter(Boolean).join(" · ");
    return {
      ok: false,
      error: redactToken(detail || `HTTP ${res.status}`, token),
      status: res.status,
      retryable: res.status >= 500,
    };
  }
  return { ok: true, data: json };
}

/**
 * Send any message type. `message` is the type-specific part, e.g.
 * { type: "text", text: { body } } or { type: "image", image: { link, caption } }.
 */
export function postMessage(
  fetchImpl: FetchLike,
  phoneNumberId: string,
  token: string,
  to: string,
  message: Record<string, unknown>,
) {
  return call<{ messages?: { id: string }[] }>(fetchImpl, `${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...message }),
  });
}

/** Read receipt (blue ticks) for an inbound message. */
export function postReadReceipt(fetchImpl: FetchLike, phoneNumberId: string, token: string, messageId: string) {
  return call<{ success?: boolean }>(fetchImpl, `${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  });
}

/** "Test connection": can this token read this phone number? */
export function getPhoneNumberInfo(fetchImpl: FetchLike, phoneNumberId: string, token: string) {
  return call<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
    fetchImpl,
    `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    token,
  );
}

/** Subscribe our Meta app to the business account's webhooks. */
export function subscribeAppToWaba(fetchImpl: FetchLike, wabaId: string, token: string) {
  return call<{ success?: boolean }>(fetchImpl, `${wabaId}/subscribed_apps`, token, { method: "POST" });
}

/** The numbers inside a business account. Fails if `wabaId` is not a WhatsApp Business Account. */
export function getWabaPhoneNumbers(fetchImpl: FetchLike, wabaId: string, token: string) {
  return call<{ data?: { id: string; display_phone_number?: string }[] }>(
    fetchImpl,
    `${wabaId}/phone_numbers?fields=id,display_phone_number`,
    token,
  );
}

/** Apps that receive this business account's webhooks (ours must be one of them). */
export function getWabaSubscribedApps(fetchImpl: FetchLike, wabaId: string, token: string) {
  return call<{ data?: { whatsapp_business_api_data?: { id?: string; name?: string } }[] }>(
    fetchImpl,
    `${wabaId}/subscribed_apps`,
    token,
  );
}

/** Step 1 of a media download: Meta gives a short-lived URL for the media_id. */
export function getMediaInfo(fetchImpl: FetchLike, mediaId: string, token: string) {
  return call<{ url?: string; mime_type?: string; file_size?: number | string }>(fetchImpl, mediaId, token);
}

/**
 * Step 2: download the bytes (the URL also needs the token).
 * Stops reading as soon as the file is bigger than `maxBytes`.
 */
export async function downloadMedia(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array; mimeType: string | null } | { ok: false; error: string; tooBig?: boolean }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    return { ok: false, error: redactToken(`Network error: ${err instanceof Error ? err.message : String(err)}`, token) };
  }
  if (!res.ok) return { ok: false, error: `Download failed: HTTP ${res.status}` };
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) return { ok: false, error: `File is too big (${declared} bytes)`, tooBig: true };
  const reader = res.body?.getReader();
  if (!reader) return { ok: false, error: "Download failed: empty body" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, error: `File is too big (more than ${maxBytes} bytes)`, tooBig: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, bytes, mimeType: res.headers.get("content-type") };
}
