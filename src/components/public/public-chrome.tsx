import type { ReactNode } from "react";
import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";

/** Header + footer for public pages (landing, privacy, terms, contact). Server only, no JS. */
export function PublicHeader({ cta }: { cta?: ReactNode }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex min-h-touch items-center gap-2 text-lg font-bold text-ink">
          <span className="flex size-9 items-center justify-center rounded-control bg-brand-700 text-white" aria-hidden>
            <UtensilsCrossed className="size-5" />
          </span>
          Orderly
        </Link>
        <nav aria-label="Main" className="ml-auto flex items-center gap-1 text-sm font-semibold">
          <Link href="/#pricing" className="hidden min-h-touch items-center px-3 sm:flex">
            Pricing
          </Link>
          <Link href="/login" className="flex min-h-touch items-center px-3">
            Log in
          </Link>
          {cta}
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© Orderly · WhatsApp ordering for restaurants in Pakistan</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2 font-semibold">
          <Link href="/privacy" className="flex min-h-touch items-center">
            Privacy
          </Link>
          <Link href="/terms" className="flex min-h-touch items-center">
            Terms
          </Link>
          <Link href="/contact" className="flex min-h-touch items-center">
            Contact
          </Link>
          <Link href="/login" className="flex min-h-touch items-center">
            Restaurant login
          </Link>
          <Link href="/rider/login" className="flex min-h-touch items-center">
            Rider login
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** Simple readable layout for the legal pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <PublicHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted">Last updated: {updated}</p>
        <div className="legal mt-6 flex flex-col gap-4 leading-relaxed [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
          {children}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
