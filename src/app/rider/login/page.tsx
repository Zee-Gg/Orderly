import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Banknote, Bike, ClipboardList, Navigation, UtensilsCrossed } from "lucide-react";
import { UrduText } from "@/components/ui/urdu-text";
import { RiderLoginForm } from "./rider-login-form";

export const metadata: Metadata = { title: "Rider login" };
export const viewport: Viewport = { themeColor: "#c2410c" };

/**
 * Phone + 6-digit PIN (riders often have no email). Mobile: one column with
 * a soft brand wash at the top. Desktop: brand panel on the left, form right.
 */
export default function RiderLoginPage() {
  return (
    <main className="min-h-dvh bg-page text-ink lg:grid lg:grid-cols-2">
      {/* Desktop brand panel */}
      <aside className="hidden flex-col justify-between bg-linear-to-br from-brand-700 to-brand-800 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-card bg-white/15">
            <UtensilsCrossed aria-hidden className="size-6" />
          </span>
          <div>
            <p className="text-lg font-bold leading-tight">Orderly</p>
            <p className="text-white/80">Delivery team</p>
          </div>
        </div>

        <div className="flex flex-col gap-8">
          <span className="flex size-24 items-center justify-center rounded-3xl bg-white text-brand-700 shadow-lg">
            <Bike aria-hidden className="size-12" />
          </span>
          <div>
            <h1 className="text-6xl font-bold tracking-tight">Rider app</h1>
            <UrduText className="mt-2 block text-left text-3xl leading-loose text-white/90">رائیڈر ایپ</UrduText>
          </div>
          <ul className="flex flex-col gap-5">
            <Feature icon={<ClipboardList aria-hidden className="size-6" />} title="See your orders as they come" urdu="آرڈر آتے ہی دیکھیں" />
            <Feature icon={<Navigation aria-hidden className="size-6" />} title="Call or open the map in one tap" urdu="ایک ٹچ میں کال یا نقشہ" />
            <Feature icon={<Banknote aria-hidden className="size-6" />} title="Know exactly how much cash to collect" urdu="کتنا کیش لینا ہے، صاف پتا" />
          </ul>
        </div>

        <p className="text-sm text-white/70">Powered by Orderly</p>
      </aside>

      {/* Form column */}
      <div className="flex min-h-dvh flex-col bg-linear-to-b from-brand-50 via-page to-page lg:justify-center lg:bg-none lg:bg-page">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-14 pb-8 lg:flex-none lg:py-12">
          {/* Mobile header */}
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <span className="flex size-20 items-center justify-center rounded-3xl bg-brand-700 text-white shadow-lg shadow-brand-700/30">
              <Bike aria-hidden className="size-10" />
            </span>
            <h1 className="mt-6 text-3xl font-bold">Rider login</h1>
            <UrduText className="mt-1 block text-2xl leading-loose text-muted">رائیڈر لاگ اِن</UrduText>
          </div>

          {/* Desktop header */}
          <div className="mb-8 hidden lg:block">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-4xl font-bold">Log in</h2>
              <UrduText className="text-3xl leading-loose">لاگ اِن</UrduText>
            </div>
            <p className="text-muted">Use the phone number and PIN your manager gave you.</p>
          </div>

          <RiderLoginForm />

          <p className="mt-auto pt-10 text-center text-muted lg:mt-8 lg:pt-0">
            Restaurant staff?{" "}
            <Link href="/login" className="font-bold text-brand-700 underline underline-offset-2">
              Log in here
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

function Feature({ icon, title, urdu }: { icon: ReactNode; title: string; urdu: string }) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-card bg-white/15">{icon}</span>
      <div>
        <p className="text-xl font-bold">{title}</p>
        <UrduText className="block text-left text-lg leading-loose text-white/85">{urdu}</UrduText>
      </div>
    </li>
  );
}
