import { parseBuffer } from "music-metadata";
import { webmToOgg } from "./webm-to-ogg";

/**
 * Voice audio in, one predictable format out. WhatsApp sends Ogg/Opus;
 * browsers record WebM/Opus (Chrome, Firefox) or MP4/AAC (Safari).
 *  - WebM is remuxed to Ogg/Opus (same audio, WhatsApp's own format)
 *  - Ogg, WAV, MP4 pass through (Groq Whisper and Gemini both read them)
 */
export type AudioFormat = "ogg" | "webm" | "wav" | "mp4" | "mp3" | "unknown";

export const AUDIO_MEDIA_TYPE: Record<Exclude<AudioFormat, "webm" | "unknown">, string> = {
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
};

/** Max voice note length (WhatsApp and the playground). */
export const MAX_VOICE_SECONDS = 120;
/** Shorter than this = nothing useful said (or an accidental tap). */
export const MIN_VOICE_SECONDS = 1;

const startsWith = (b: Uint8Array, ascii: string, at = 0) => [...ascii].every((c, i) => b[at + i] === c.charCodeAt(0));

/** Detect by the file's first bytes (more reliable than a MIME label). */
export function detectAudioFormat(bytes: Uint8Array): AudioFormat {
  if (startsWith(bytes, "OggS")) return "ogg";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (startsWith(bytes, "RIFF") && startsWith(bytes, "WAVE", 8)) return "wav";
  if (startsWith(bytes, "ftyp", 4)) return "mp4";
  if (startsWith(bytes, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  return "unknown";
}

export type NormalizedAudio = { bytes: Uint8Array; mediaType: string; format: Exclude<AudioFormat, "webm" | "unknown">; converted: boolean };

export function normalizeAudio(bytes: Uint8Array): NormalizedAudio {
  const format = detectAudioFormat(bytes);
  if (format === "webm") return { bytes: webmToOgg(bytes), mediaType: AUDIO_MEDIA_TYPE.ogg, format: "ogg", converted: true };
  if (format === "unknown") throw new Error("Unsupported audio format");
  return { bytes, mediaType: AUDIO_MEDIA_TYPE[format], format, converted: false };
}

/** Duration in seconds, or null when the file doesn't say. */
export async function audioDurationSeconds(audio: NormalizedAudio): Promise<number | null> {
  try {
    const meta = await parseBuffer(audio.bytes, { mimeType: audio.mediaType }, { duration: true, skipCovers: true });
    const d = meta.format.duration;
    return typeof d === "number" && Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}
