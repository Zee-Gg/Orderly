import { MEDIA_MAX_BYTES } from "./config";
import { decryptToken } from "./crypto";
import { downloadMedia, getMediaInfo, type FetchLike } from "./graph";
import type { AccountRecord, MediaResult, WhatsAppStore } from "./store";

/** Customer media we keep (for the inbox now, the AI bot in Phase 7). */
export const MEDIA_TYPES = new Set(["image", "audio", "document"]);

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** "audio/ogg; codecs=opus" → "audio/ogg" */
export function baseMimeType(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

export function mediaPath(restaurantId: string, messageId: string, mimeType: string): string {
  return `${restaurantId}/${messageId}.${EXTENSIONS[baseMimeType(mimeType)] ?? "bin"}`;
}

/**
 * Download a customer's file from Meta and keep it in our private bucket:
 * media_id → short-lived URL → bytes → Storage → path saved on the message.
 * Files over 16 MB are skipped (error saved on the message). Never throws.
 */
export async function storeInboundMedia(
  deps: { store: WhatsAppStore; fetch?: FetchLike; decrypt?: (stored: string) => string },
  account: AccountRecord,
  messageId: string,
  mediaId: string,
): Promise<MediaResult> {
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
  const decrypt = deps.decrypt ?? ((s: string) => decryptToken(s));
  const restaurantId = account.restaurantId;

  const finish = async (result: MediaResult) => {
    try {
      await deps.store.saveMediaResult(restaurantId, messageId, result);
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
    return result;
  };

  let token: string;
  try {
    token = decrypt(account.accessTokenEncrypted);
  } catch {
    return finish({ ok: false, error: "Media not saved: could not decrypt the access token" });
  }

  const info = await getMediaInfo(fetchImpl, mediaId, token);
  if (!info.ok) return finish({ ok: false, error: `Media not saved: ${info.error}` });
  if (!info.data.url) return finish({ ok: false, error: "Media not saved: Meta returned no download link" });
  const declared = Number(info.data.file_size ?? 0);
  if (declared > MEDIA_MAX_BYTES) {
    return finish({ ok: false, error: `Media not saved: file is bigger than 16 MB (${declared} bytes)` });
  }

  const file = await downloadMedia(fetchImpl, info.data.url, token, MEDIA_MAX_BYTES);
  if (!file.ok) {
    return finish({ ok: false, error: file.tooBig ? "Media not saved: file is bigger than 16 MB" : `Media not saved: ${file.error}` });
  }

  const mimeType = baseMimeType(info.data.mime_type ?? file.mimeType);
  const path = mediaPath(restaurantId, messageId, mimeType);
  try {
    await deps.store.uploadMedia(path, file.bytes, mimeType);
  } catch (err) {
    return finish({ ok: false, error: `Media not saved: ${err instanceof Error ? err.message : String(err)}` });
  }
  return finish({ ok: true, path, mimeType, size: file.bytes.byteLength });
}
