import type { Metadata } from "next";
import { Bike } from "lucide-react";
import { RiderLoginForm } from "./rider-login-form";

export const metadata: Metadata = { title: "Rider login" };

/** Phone + 6-digit PIN (riders often have no email). */
export default function RiderLoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-status-delivery-bg text-status-delivery-fg">
          <Bike aria-hidden className="size-10" />
        </span>
        <h1 className="text-3xl font-bold">Rider login</h1>
        <p className="text-muted">Phone number aur PIN likhein</p>
      </div>
      <RiderLoginForm />
    </main>
  );
}
