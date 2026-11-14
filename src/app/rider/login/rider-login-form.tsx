"use client";

import { useActionState, useState } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, LockOpen, Phone } from "lucide-react";
import { UrduText } from "@/components/ui/urdu-text";
import { riderLoginAction } from "@/lib/riders/login";

const PIN_LENGTH = 6;

/** What the rider typed after "+92" → the full number for the server ("0300…" and "92300…" also work). */
function fullPhone(typed: string): string {
  let digits = typed.replace(/\D/g, "");
  if (digits.startsWith("92") && digits.length > 10) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits ? `+92${digits}` : "";
}

export function RiderLoginForm() {
  const [state, action, pending] = useActionState(riderLoginAction, null);
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinFocused, setPinFocused] = useState(false);
  const [showPin, setShowPin] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-6" data-testid="rider-login-form">
      {state && !state.ok ? (
        <p role="alert" className="flex items-start gap-2 rounded-card border border-status-cancelled-border bg-status-cancelled-bg p-3 font-semibold text-danger">
          <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="rider-phone" className="flex items-end justify-between gap-2">
          <span className="text-lg font-bold">Phone number</span>
          <UrduText className="text-lg leading-loose text-muted">فون نمبر</UrduText>
        </label>
        <div className="flex h-16 overflow-hidden rounded-card border-2 border-line-strong bg-surface focus-within:border-brand-700 focus-within:ring-4 focus-within:ring-brand-100">
          <span className="flex shrink-0 items-center gap-2 border-r-2 border-line-strong bg-subtle px-4 text-xl font-semibold text-muted">
            <Phone aria-hidden className="size-5" /> +92
          </span>
          <input
            id="rider-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d\s-]/g, ""))}
            placeholder="300 1234567"
            className="min-w-0 flex-1 bg-transparent px-4 text-2xl font-semibold tracking-wide outline-none placeholder:font-normal placeholder:text-line-strong"
          />
        </div>
        <input type="hidden" name="phone" value={fullPhone(phone)} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="rider-pin" className="flex items-end justify-between gap-2">
          <span className="text-lg font-bold">6-digit PIN</span>
          <UrduText className="text-lg leading-loose text-muted">٦ ہندسوں کا PIN</UrduText>
        </label>
        {/* One real input (keyboard, autofill, the form) drawn as 6 boxes. */}
        <div className="relative">
          <div aria-hidden className="grid grid-cols-6 gap-2 sm:gap-3">
            {Array.from({ length: PIN_LENGTH }, (_, i) => {
              const filled = i < pin.length;
              const active = pinFocused && i === Math.min(pin.length, PIN_LENGTH - 1);
              return (
                <span
                  key={i}
                  className={`flex aspect-[4/5] max-h-20 items-center justify-center rounded-card border-2 bg-surface text-2xl font-bold ${
                    active ? "border-brand-700 ring-4 ring-brand-100" : filled ? "border-muted/50" : "border-line"
                  }`}
                >
                  {filled ? (
                    showPin ? pin[i] : <span className="size-3.5 rounded-full bg-ink" />
                  ) : active ? (
                    <span className="h-7 w-0.5 animate-pulse rounded-full bg-brand-700" />
                  ) : null}
                </span>
              );
            })}
          </div>
          <input
            id="rider-pin"
            name="pin"
            type={showPin ? "text" : "password"}
            inputMode="numeric"
            autoComplete="current-password"
            pattern="\d{6}"
            maxLength={PIN_LENGTH}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
            onFocus={() => setPinFocused(true)}
            onBlur={() => setPinFocused(false)}
            className="absolute inset-0 h-full w-full cursor-text opacity-0"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowPin((s) => !s)}
          aria-pressed={showPin}
          className="flex min-h-touch items-center gap-2 self-end px-1 font-semibold text-muted"
        >
          {showPin ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
          {showPin ? "Hide PIN" : "Show PIN"}
        </button>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="flex h-16 items-center justify-center gap-4 rounded-card bg-brand-700 text-2xl font-bold text-white shadow-lg shadow-brand-700/25 transition-colors hover:bg-brand-800 disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 aria-hidden className="size-6 animate-spin" /> Logging in…
          </>
        ) : (
          <>
            Login
            <UrduText className="text-xl leading-loose text-white/90">لاگ اِن</UrduText>
            <ArrowRight aria-hidden className="size-6" />
          </>
        )}
      </button>

      <div className="flex items-center gap-4 rounded-card border border-line bg-surface p-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-card bg-subtle">
          <LockOpen aria-hidden className="size-6 text-muted" />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-bold">Forgot your PIN?</p>
          <p className="text-muted">Ask your manager for a new one.</p>
          <UrduText className="block text-right leading-loose text-muted">PIN بھول گئے؟ مینیجر سے نیا PIN لیں</UrduText>
        </div>
      </div>
    </form>
  );
}
