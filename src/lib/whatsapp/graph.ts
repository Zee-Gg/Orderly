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

export function postTextMessage(fetchImpl: FetchLike, phoneNumberId: string, token: string, to: string, body: string) {
  return call<{ messages?: { id: string }[] }>(fetchImpl, `${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
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
