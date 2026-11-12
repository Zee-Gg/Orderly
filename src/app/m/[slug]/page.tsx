import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { MenuApp } from "@/components/menu-page/menu-app";
import { loadPublicMenu, pageState } from "@/lib/menu-page/data";
import { LANG_COOKIE, texts, type PageLang } from "@/lib/menu-page/i18n";

/**
 * Public customer menu (Phase 8, no login). Server-rendered; the menu data is
 * cached per restaurant (cleared when the menu changes), open/closed and
 * today's offers are worked out for every request. The cart is sent back to
 * the restaurant on WhatsApp with a short code.
 */
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ branch?: string | string[] }> };

const branchOf = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const data = await loadPublicMenu(slug, branchOf(sp.branch));
  if (!data) return { title: { absolute: "Menu not available" }, robots: { index: false } };
  const title = `${data.restaurant.name} — Order on WhatsApp`;
  const description = `See the menu of ${data.restaurant.name}, pick your items and send your order on WhatsApp.`;
  return {
    title: { absolute: title },
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: data.restaurant.name,
      ...(data.restaurant.logoUrl ? { images: [{ url: data.restaurant.logoUrl, width: 512, height: 512, alt: data.restaurant.name }] } : {}),
    },
    twitter: { card: data.restaurant.logoUrl ? "summary" : "summary", title, description },
  };
}

async function MenuContent({ params, searchParams }: Props) {
  await connection(); // open/closed and offers depend on the time of this request
  const [{ slug }, sp, jar] = await Promise.all([params, searchParams, cookies()]);
  const lang: PageLang = jar.get(LANG_COOKIE)?.value === "ur" ? "ur" : "en";
  const data = await loadPublicMenu(slug, branchOf(sp.branch));
  if (!data) return <NotAvailable lang={lang} />;
  return <MenuApp data={data} state={pageState(data)} initialLang={lang} />;
}

function NotAvailable({ lang }: { lang: PageLang }) {
  const tx = texts(lang);
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-2 p-6 text-center" data-testid="menu-not-available">
      <span aria-hidden className="text-5xl">🍽️</span>
      <h1 className="text-xl font-bold">{tx.notAvailableTitle}</h1>
      <p className="text-muted">{tx.notAvailableText}</p>
    </main>
  );
}

function Loading() {
  return (
    <div className="mx-auto max-w-lg animate-pulse p-4" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="size-14 rounded-card bg-line" />
        <div className="h-6 w-40 rounded bg-line" />
      </div>
      <div className="mt-4 h-12 rounded-card bg-line" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="mt-4 flex gap-3">
          <div className="h-24 flex-1 rounded bg-line" />
          <div className="size-24 rounded-card bg-line" />
        </div>
      ))}
    </div>
  );
}

export default function MenuPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <MenuContent {...props} />
    </Suspense>
  );
}
