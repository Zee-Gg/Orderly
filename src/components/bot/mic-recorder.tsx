"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * WhatsApp-style mic: press and hold to record, release to send — or tap to
 * start and tap again to send. ✕ cancels. Stops by itself at `maxSeconds`.
 * Records with MediaRecorder (WebM/Opus in Chrome, MP4 in Safari); the server
 * turns it into the same Ogg/Opus format as WhatsApp voice notes.
 */
const HOLD_MS = 350;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function MicRecorder({
  onRecorded,
  disabled,
  maxSeconds = 120,
  className,
}: {
  onRecorded: (audio: Blob, seconds: number) => void;
  disabled?: boolean;
  maxSeconds?: number;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "starting" | "recording">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const pressedAt = useRef(0);
  const holdMode = useRef(false);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    setState("idle");
    setSeconds(0);
  };
  useEffect(() => () => cleanup(), []); // stop the mic when leaving the page

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("The mic only works on localhost or HTTPS, in a browser that can record audio.");
      return;
    }
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setState("idle");
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Allow microphone access in your browser settings, then try again."
          : name === "NotFoundError"
            ? "No microphone found. Plug one in and try again."
            : "Couldn't start the microphone.",
      );
      return;
    }
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    cancelled.current = false;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      const secs = (Date.now() - startedAt.current) / 1000;
      const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || "audio/webm" });
      cleanup();
      if (!cancelled.current && blob.size) onRecorded(blob, secs);
    };
    recorder.current = rec;
    startedAt.current = Date.now();
    rec.start(250);
    setState("recording");
    timer.current = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSeconds(s);
      if (s >= maxSeconds) stop(); // WhatsApp-style limit
    }, 200);
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function cancel() {
    cancelled.current = true;
    stop();
  }

  // Press-and-hold OR tap-to-start/tap-to-stop with one button.
  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    pressedAt.current = Date.now();
    if (state === "idle") {
      holdMode.current = true;
      void start();
    }
  };
  const onPointerUp = () => {
    if (state === "idle" && !recorder.current) return;
    const held = Date.now() - pressedAt.current;
    if (holdMode.current && held >= HOLD_MS) {
      holdMode.current = false;
      stop(); // released after holding → send
    } else if (holdMode.current) {
      holdMode.current = false; // a quick tap → keep recording until the next tap
    } else {
      stop(); // second tap → send
    }
  };

  const recording = state === "recording";
  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      {recording ? (
        <div className="flex items-center gap-2 rounded-control bg-status-cancelled-bg px-3 py-1.5 text-sm font-semibold text-status-cancelled-fg" role="status">
          <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
          Recording {clock(seconds)} / {clock(maxSeconds)}
          <button type="button" onClick={cancel} className="flex size-touch items-center justify-center rounded-control hover:bg-white/60" aria-label="Cancel recording">
            <X aria-hidden className="size-5" />
          </button>
          <button type="button" onClick={stop} className="flex size-touch items-center justify-center rounded-control hover:bg-white/60" aria-label="Send voice note">
            <Send aria-hidden className="size-5" />
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => holdMode.current && recording && Date.now() - pressedAt.current >= HOLD_MS && stop()}
        onContextMenu={(e) => e.preventDefault()}
        disabled={disabled || state === "starting"}
        aria-label={recording ? "Recording — release or tap to send" : "Record a voice note (hold, or tap to start)"}
        aria-pressed={recording}
        className={cn(
          "flex size-touch-lg shrink-0 select-none items-center justify-center rounded-full text-white shadow-card transition-colors disabled:opacity-50",
          recording ? "bg-danger" : "bg-whatsapp hover:brightness-95",
        )}
      >
        <Mic aria-hidden className="size-6" />
      </button>
      {error ? (
        <p className="max-w-64 text-right text-xs font-semibold text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
