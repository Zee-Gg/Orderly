"use client";

import { useActionState } from "react";
import { Lock, Phone } from "lucide-react";
import { riderLoginAction } from "@/lib/riders/login";

export function RiderLoginForm() {
  const [state, action, pending] = useActionState(riderLoginAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state && !state.ok ? (
        <p role="alert" className="rounded-card bg-status-cancelled-bg p-3 text-center text-lg font-semibold text-danger">
          {state.error}
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-lg font-bold">
        <span className="flex items-center gap-2">
          <Phone aria-hidden className="size-5" /> Phone number
        </span>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="0300 1234567"
          className="h-16 rounded-card border-2 border-line-strong px-4 text-2xl tracking-wide"
        />
      </label>
      <label className="flex flex-col gap-1 text-lg font-bold">
        <span className="flex items-center gap-2">
          <Lock aria-hidden className="size-5" /> PIN (6 digits)
        </span>
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          pattern="\d{6}"
          maxLength={6}
          required
          className="h-16 rounded-card border-2 border-line-strong px-4 text-center text-3xl tracking-[0.5em]"
        />
      </label>
      <button type="submit" disabled={pending} className="h-16 rounded-card bg-brand-700 text-2xl font-bold text-white disabled:opacity-60">
        {pending ? "…" : "Login"}
      </button>
      <p className="text-center text-sm text-muted">PIN bhool gaye? Manager se naya PIN lein.</p>
    </form>
  );
}
