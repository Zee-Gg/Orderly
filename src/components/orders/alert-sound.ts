"use client";

/**
 * New-order chime, generated with Web Audio (no sound file to download).
 * Browsers only allow audio after the user has tapped the page, so sound is
 * opt-in ("Enable sound") and the choice is remembered on this device.
 */
const STORAGE_KEY = "orderly:sound";
let context: AudioContext | null = null;

export function soundPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setSoundPreference(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Private mode etc. — sound still works for this visit.
  }
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

/** Call from a click/tap handler to unlock audio. Returns true if it's ready. */
export async function unlockAudio(): Promise<boolean> {
  const ctx = getContext();
  if (!ctx) return false;
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  return ctx.state === "running";
}

export function audioReady(): boolean {
  return context?.state === "running";
}

/** Three rising notes, loud enough for a noisy kitchen counter. */
export function playChime(urgent = false) {
  const ctx = getContext();
  if (!ctx || ctx.state !== "running") return;
  const notes = urgent ? [880, 660, 880, 660] : [660, 880, 1175];
  notes.forEach((freq, i) => {
    const start = ctx.currentTime + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  });
}
