import type { Metadata } from "next";
import {
  Bike,
  Bot,
  ChartColumn,
  ChefHat,
  Check,
  LayoutDashboard,
  MessageCircle,
  Mic,
  QrCode,
  Send,
  ShoppingBag,
} from "lucide-react";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { buttonVariants } from "@/components/ui/button";
import { limitText, waLink } from "@/lib/billing/core";
import { formatPKR } from "@/lib/money";
import { loadPublicPlatform } from "@/lib/public/platform";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Orderly — WhatsApp ordering with AI for restaurants in Pakistan" },
  description:
    "Customers order on WhatsApp in English, Urdu or Roman Urdu — even with voice notes. Your AI bot takes the order, your staff sees it live, the kitchen cooks, riders deliver.",
};

/**
 * Public landing page for signed-out visitors (Phase 12). Signed-in users
 * never see it: the proxy sends them to /auth/continue. Static + cached
 * (plans and the demo number come from the database, refreshed on change).
 */
const STEPS = [
  { icon: MessageCircle, title: "Customer sends a WhatsApp", text: "In English, Urdu or Roman Urdu — typed or a voice note. Or they pick from your menu page and send a short code." },
  { icon: Bot, title: "The AI bot takes the order", text: "It answers questions, suggests items, asks for the address and payment, and shows the full bill. Prices always come from your menu." },
  { icon: ChefHat, title: "You cook and deliver", text: "Confirmed orders pop up on your dashboard with a sound. The kitchen screen, printer and riders take it from there." },
];

const FEATURES = [
  { icon: Mic, title: "AI WhatsApp bot with voice notes", text: "Understands Roman Urdu, Urdu and English, and voice notes. Hands the chat to your staff when needed." },
  { icon: LayoutDashboard, title: "Live orders dashboard", text: "New orders with a sound, one tap to accept, edit or cancel. Works on cheap phones and weak internet." },
  { icon: ChefHat, title: "Kitchen screen", text: "Big, clear tickets for the kitchen tablet. Start and Ready buttons. Kitchen slips print from the browser." },
  { icon: Bike, title: "Riders", text: "Riders log in with phone + PIN, see their deliveries, and mark them delivered. Cash is tracked for you." },
  { icon: QrCode, title: "Menu page + QR", text: "A fast mobile menu customers open from a QR or link. Their cart arrives in WhatsApp as a short code." },
  { icon: ChartColumn, title: "Reports", text: "Sales, best sellers, busy hours, riders and customers — in plain words, not spreadsheets." },
];

const FAQ = [
  { q: "Do I need a new WhatsApp number?", a: "Yes — a number that is not on the normal WhatsApp app. A new SIM works best. We set up the WhatsApp Business connection for you." },
  { q: "Does the AI ever make up prices?", a: "No. Every price and total comes from your own menu. The customer sees the full bill and must press Confirm before the order reaches you." },
  { q: "Can customers send voice notes?", a: "Yes. The bot listens to voice notes in Urdu, Roman Urdu or English and tells the customer what it understood." },
  { q: "What if the bot can't help?", a: "It hands the chat to your staff with an alert. Staff reply from the inbox in the dashboard." },
  { q: "Do I need special hardware?", a: "No. Any phone, tablet or computer with a browser. Receipts print on a normal thermal printer from the browser." },
  { q: "How do I pay?", a: "Monthly, by bank transfer, JazzCash, Easypaisa or cash. Start with a free trial." },
];

export default async function Landing() {
  const { plans, salesWhatsapp } = await loadPublicPlatform();
  const demo = waLink(salesWhatsapp, "Assalam o Alaikum! I want a demo of Orderly for my restaurant.");
  const demoButton = (big = false) =>
    demo ? (
      <a href={demo} target="_blank" rel="noreferrer" className={buttonVariants({ size: big ? "lg" : "md" })} data-testid="book-demo">
        <Send aria-hidden /> Book a demo on WhatsApp
      </a>
    ) : (
      <a href="/contact" className={buttonVariants({ size: big ? "lg" : "md" })}>
        <Send aria-hidden /> Book a demo
      </a>
    );

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <PublicHeader cta={<span className="hidden sm:block">{demoButton()}</span>} />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 lg:grid-cols-2 lg:py-20">
          <div className="flex flex-col gap-5">
            <p className="w-fit rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-800">Made for restaurants in Pakistan 🇵🇰</p>
            <h1 className="text-4xl font-bold leading-tight text-ink lg:text-5xl">WhatsApp ordering with AI for your restaurant</h1>
            <p className="text-lg text-muted">
              Customers order on WhatsApp in Urdu, Roman Urdu or English — even with voice notes. The AI bot takes the order, you get it live on your
              dashboard, the kitchen cooks and riders deliver.
            </p>
            <div className="flex flex-wrap gap-3">
              {demoButton(true)}
              <a href="#pricing" className={buttonVariants({ variant: "secondary", size: "lg" })}>
                See prices
              </a>
            </div>
          </div>
          <div className="rounded-panel border border-line bg-surface p-4 shadow-card" aria-hidden>
            <div className="flex flex-col gap-2 rounded-card bg-[#efeae2] p-4 text-sm">
              <p className="max-w-[80%] self-end rounded-card bg-[#d9fdd3] px-3 py-2">Bhai 2 zinger burger aur 1 large fries bhej do, DHA phase 5</p>
              <p className="max-w-[85%] rounded-card bg-white px-3 py-2">
                Zaroor! 🍔 Aap ka order:
                <br />2× Zinger Burger — Rs 1,300
                <br />1× Fries (Large) — Rs 350
                <br />
                Delivery — Rs 150
                <br />
                <strong>Total: Rs 1,800</strong>
                <br />
                Confirm karein?
              </p>
              <p className="max-w-[60%] self-end rounded-card bg-[#d9fdd3] px-3 py-2">✅ Haan, confirm</p>
              <p className="max-w-[85%] rounded-card bg-white px-3 py-2">Shukriya! Order #1042 mil gaya. 30–40 minute mein pohanch jayega. 🛵</p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-6xl px-4 py-10" aria-labelledby="how">
          <h2 id="how" className="text-3xl font-bold">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-card border border-line bg-surface p-5">
                <span className="flex size-12 items-center justify-center rounded-full bg-brand-700 text-white" aria-hidden>
                  <s.icon className="size-6" />
                </span>
                <h3 className="mt-3 text-lg font-bold">
                  {i + 1}. {s.title}
                </h3>
                <p className="mt-1 text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 py-10" aria-labelledby="features">
          <h2 id="features" className="text-3xl font-bold">
            Everything your restaurant needs
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4 rounded-card border border-line bg-surface p-5">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700" aria-hidden>
                  <f.icon className="size-6" />
                </span>
                <span>
                  <h3 className="font-bold">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted">{f.text}</p>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-4 px-4 py-10" aria-labelledby="pricing-title">
          <h2 id="pricing-title" className="text-3xl font-bold">
            Simple monthly prices
          </h2>
          <p className="mt-1 text-muted">Free trial first. Pay monthly by bank transfer, JazzCash, Easypaisa or cash. No setup fee.</p>
          {plans.length === 0 ? (
            <p className="mt-6 rounded-card border-2 border-dashed border-line p-6 text-center text-muted">Message us on WhatsApp for prices.</p>
          ) : (
            <ul className={cn("mt-6 grid gap-4", plans.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")} data-testid="pricing">
              {plans.map((p, i) => (
                <li key={p.id} className={cn("flex flex-col gap-3 rounded-panel border bg-surface p-6", i === 1 ? "border-2 border-brand-700 shadow-card" : "border-line")}>
                  <h3 className="text-xl font-bold">{p.name}</h3>
                  <p>
                    <span className="text-3xl font-bold">{formatPKR(p.monthlyPrice)}</span>
                    <span className="text-muted"> / month</span>
                  </p>
                  {p.description ? <p className="text-sm text-muted">{p.description}</p> : null}
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {[
                      `${p.maxBranches} branch${p.maxBranches === 1 ? "" : "es"}`,
                      `${limitText(p.maxOrdersPerMonth)} orders a month`,
                      `${limitText(p.maxBotConversationsPerMonth)} AI bot chats a month`,
                      "Kitchen screen, riders, menu page, reports",
                    ].map((t) => (
                      <li key={t} className="flex items-start gap-2">
                        <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-status-ready-fg" /> {t}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-10" aria-labelledby="faq">
          <h2 id="faq" className="text-3xl font-bold">
            Questions
          </h2>
          <div className="mt-6 flex flex-col gap-2">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-card border border-line bg-surface">
                <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold">
                  {f.q}
                  <span aria-hidden className="text-xl text-muted group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="px-4 pb-4 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex flex-col items-start gap-4 rounded-panel bg-brand-700 p-8 text-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold">Ready to take orders on WhatsApp?</h2>
              <p className="text-brand-100">We set everything up with you — menu, number, printer and staff.</p>
            </div>
            {demo ? (
              <a href={demo} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "secondary", size: "lg" })}>
                <ShoppingBag aria-hidden /> Book a demo
              </a>
            ) : null}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
