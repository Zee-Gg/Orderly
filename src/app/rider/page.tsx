import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Bike } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { getRiderHome } from "@/lib/riders/queries";
import { RiderScreen } from "./rider-screen";

export const metadata: Metadata = { title: "My deliveries" };
export const viewport: Viewport = { themeColor: "#1c1917" };

/** Rider's mobile page (Phase 9): assigned orders, big buttons, cash to collect. */
async function Rider() {
  const ctx = await requirePermission("deliveries.view", { onDenied: "redirect" });
  const home = await getRiderHome(ctx);
  if (!home) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-3 p-6 text-center">
        <Bike aria-hidden className="size-12 text-muted" />
        <h1 className="text-2xl font-bold">Your rider account is switched off</h1>
        <p className="text-muted">Please talk to the manager.</p>
      </main>
    );
  }
  return <RiderScreen initial={home} />;
}

export default function RiderPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-lg animate-pulse p-4"><div className="h-16 rounded-card bg-line" /><div className="mt-4 h-72 rounded-panel bg-line" /></div>}>
      <Rider />
    </Suspense>
  );
}
