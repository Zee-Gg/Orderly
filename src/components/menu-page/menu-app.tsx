"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import {
  Bike,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageCircle,
  Minus,
  Plus,
  Search,
  ShoppingBag,
} from "lucide-react";
import { computeOrderTotals } from "@/lib/menu/pricing";
import type { PageItem, PageState, PublicMenu } from "@/lib/menu-page/data";
import {
  LANG_COOKIE,
  pick,
  rs,
  texts,
  waLink,
  whatsappMessage,
  type PageLang,
} from "@/lib/menu-page/i18n";
import {
  addLine,
  getCart,
  goTo,
  priceLine,
  rememberLang,
  serverCart,
  subscribeCart,
  updateCart,
  type OrderType,
  type PageCart,
  type PageCartLine,
} from "./cart";
import { ItemSheet } from "./item-sheet";

type Problem = { key: string; message: string };
type Sent = { code: string; link: string | null };

/** A popstate right after our own history.back() (closing an inner panel) is not the Back button. */
const ownPop = { until: 0 };

/** Close a panel with the phone's Back button (adds one history entry while open). */
function useBackToClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    history.pushState({ panel: true }, "");
    let closedByBack = false;
    const onPop = () => {
      if (Date.now() < ownPop.until) {
        ownPop.until = 0; // our own cleanup of an inner panel (e.g. the item sheet over the cart)
        return;
      }
      closedByBack = true;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!closedByBack && history.state?.panel) {
        ownPop.until = Date.now() + 400;
        history.back();
      }
    };
  }, [open]);
}

export function MenuApp({
  data,
  state,
  initialLang,
}: {
  data: PublicMenu;
  state: PageState;
  initialLang: PageLang;
}) {
  const [lang, setLang] = useState<PageLang>(initialLang);
  const tx = texts(lang);
  const rid = data.restaurant.id;
  const branch = data.branches.find((b) => b.id === data.branchId)!;
  const items = useMemo(
    () =>
      new Map(data.categories.flatMap((c) => c.items).map((i) => [i.id, i])),
    [data],
  );

  const cart = useSyncExternalStore(
    subscribeCart,
    () => getCart(rid, data.branchId),
    () => serverCart(data.branchId),
  );
  const setCart = (fn: (c: PageCart) => PageCart) =>
    updateCart(rid, data.branchId, fn);

  // One page view per visit (per tab session).
  useEffect(() => {
    try {
      const key = `orderly_viewed:${rid}:${data.branchId}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // storage blocked: count anyway
    }
    const body = JSON.stringify({ restaurantId: rid, branchId: data.branchId });
    if (!navigator.sendBeacon?.("/api/public/menu-views", body)) {
      void fetch("/api/public/menu-views", {
        method: "POST",
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }, [rid, data.branchId]);

  const [view, setView] = useState<"menu" | "cart">("menu");
  const [sheet, setSheet] = useState<{
    item: PageItem;
    editing: PageCartLine | null;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  useBackToClose(view === "cart", () => setView("menu"));
  useBackToClose(!!sheet, () => setSheet(null));

  function switchLang(next: PageLang) {
    setLang(next);
    rememberLang(next, LANG_COOKIE);
  }
  const setOrderType = (orderType: OrderType) =>
    setCart((c) => ({ ...c, orderType }));
  const setLines = (fn: (lines: PageCartLine[]) => PageCartLine[]) => {
    setProblems([]);
    setCart((c) => ({ ...c, lines: fn(c.lines) }));
  };

  // Every line priced by the engine from this menu.
  const priced = cart.lines.map((l) => ({
    line: l,
    item: items.get(l.itemId),
    result: priceLine(rid, data.branchId, items.get(l.itemId), l),
  }));
  const okLines = priced.flatMap((p) => (p.result?.ok ? [p.result.line] : []));
  const count = cart.lines.reduce((n, l) => n + l.quantity, 0);
  const totals = computeOrderTotals({
    lines: okLines,
    deliveryFee: cart.orderType === "delivery" ? branch.deliveryFee : 0,
  });
  const subtotal = totals.ok ? totals.totals.subtotal : 0;
  const belowMinimum =
    cart.orderType === "delivery" &&
    branch.minimumOrder > 0 &&
    subtotal < branch.minimumOrder;
  const badLines = priced.filter((p) => !p.result?.ok);
  const inCart = (id: string) =>
    cart.lines
      .filter((l) => l.itemId === id)
      .reduce((n, l) => n + l.quantity, 0);
  const canSend =
    state.isOpen &&
    !!data.whatsappNumber &&
    okLines.length > 0 &&
    !badLines.length &&
    !belowMinimum &&
    !sending;

  const q = query.trim().toLowerCase();
  const categories = data.categories
    .map((c) => ({
      ...c,
      items: q
        ? c.items.filter((i) =>
            [i.name, i.nameUr, i.description, c.name].some((x) =>
              x?.toLowerCase().includes(q),
            ),
          )
        : c.items,
    }))
    .filter((c) => c.items.length);
  const deals = data.offers.filter((o) => state.activeOfferIds.includes(o.id));

  const statusLine = state.isOpen
    ? `${tx.open} · ${cart.orderType === "delivery" ? tx.deliveryTime(...state.deliveryRange) : tx.pickupTime(state.prepMinutes)}`
    : `${tx.closed}${state.opensAt ? ` · ${tx.opensAt(state.opensAt)}` : ""}`;

  function openItem(item: PageItem) {
    if (!item.isAvailable) return;
    setSheet({ item, editing: null });
  }

  async function send() {
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/public/cart-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: data.restaurant.slug,
          branchId: data.branchId,
          orderType: cart.orderType,
          language: lang,
          lines: cart.lines.map(
            ({ itemId, variantId, optionIds, removals, quantity, notes }) => ({
              itemId,
              variantId,
              optionIds,
              removals,
              quantity,
              notes,
            }),
          ),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; code: string }
        | {
            ok: false;
            error: string;
            message: string;
            problems?: { index: number; message: string }[];
          }
        | null;
      if (!body) throw new Error("network");
      if (!body.ok) {
        if (body.problems?.length) {
          setProblems(
            body.problems.map((p) => ({
              key: cart.lines[p.index]?.key ?? "",
              message: p.message,
            })),
          );
          setError(tx.fixCart);
        } else
          setError(body.error === "RATE_LIMITED" ? tx.tooMany : body.message);
        return;
      }
      const labels = priced.map((p) => ({
        quantity: p.line.quantity,
        label: `${p.result?.ok && p.result.line.sizeName ? `${pick(lang, p.result.line.sizeName, p.item?.sizes.find((s) => s.id === p.line.variantId)?.nameUr)} ` : ""}${pick(lang, p.item?.name ?? "", p.item?.nameUr)}`,
      }));
      const link = waLink(
        data.whatsappNumber!,
        whatsappMessage(lang, body.code, labels, cart.orderType),
      );
      setSent({ code: body.code, link });
      setCart((c) => ({ ...c, lines: [] }));
      if (link) goTo(link);
    } catch {
      setError(tx.networkError);
    } finally {
      setSending(false);
    }
  }

  const dirProps =
    lang === "ur"
      ? {
          dir: "rtl" as const,
          lang: "ur",
          className: "font-mixed-urdu leading-loose",
        }
      : { dir: "ltr" as const, lang: "en", className: "" };

  return (
    <div
      {...dirProps}
      className={`mx-auto min-h-dvh max-w-lg bg-page pb-28 text-ink ${dirProps.className}`}
      data-testid="menu-page"
    >
      {view === "menu" ? (
        <>
          <header className="bg-surface px-4 pb-3 pt-4">
            <div className="flex items-center gap-3">
              {data.restaurant.logoUrl ? (
                <Image
                  src={data.restaurant.logoUrl}
                  alt=""
                  width={56}
                  height={56}
                  priority
                  className="size-14 shrink-0 rounded-card object-cover"
                />
              ) : (
                <span
                  className="flex size-14 shrink-0 items-center justify-center rounded-card bg-brand-700 text-xl font-bold text-white"
                  aria-hidden
                >
                  {initials(data.restaurant.name)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-bold">
                  {data.restaurant.name}
                </h1>
                <p
                  className={`flex items-center gap-1.5 text-sm font-semibold ${state.isOpen ? "text-status-ready-fg" : "text-status-cancelled-fg"}`}
                  data-testid="open-status"
                >
                  <span
                    aria-hidden
                    className={`size-2 rounded-full ${state.isOpen ? "bg-whatsapp" : "bg-danger"}`}
                  />
                  {statusLine}
                </p>
              </div>
              <div
                className="flex shrink-0 overflow-hidden rounded-control border border-line-strong"
                role="group"
                aria-label="Language"
              >
                {(["en", "ur"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    onClick={() => switchLang(l)}
                    // System font for the label: the big Nastaliq font loads only when Urdu is chosen.
                    className={`min-h-touch px-3 text-sm font-bold ${lang === l ? "bg-ink text-white" : "bg-surface"}`}
                  >
                    {l === "en" ? "EN" : "اردو"}
                  </button>
                ))}
              </div>
            </div>

            {data.branches.length > 1 ? (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <span className="text-muted">{tx.branch}:</span>
                <select
                  value={data.branchId}
                  onChange={(e) => {
                    const url = new URL(window.location.href);
                    url.searchParams.set("branch", e.target.value);
                    goTo(url);
                  }}
                  className="min-h-touch flex-1 rounded-control border border-line-strong bg-surface px-2"
                >
                  {data.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.area ? ` · ${b.area}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div
              className="mt-3 grid grid-cols-2 gap-1 rounded-card bg-subtle p-1"
              role="group"
              aria-label={`${tx.delivery} / ${tx.pickup}`}
            >
              {(["delivery", "pickup"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={cart.orderType === t}
                  onClick={() => setOrderType(t)}
                  className={`flex min-h-touch items-center justify-center gap-2 rounded-control font-semibold ${cart.orderType === t ? "bg-surface shadow-card" : "text-muted"}`}
                >
                  {t === "delivery" ? (
                    <Bike aria-hidden className="size-5" />
                  ) : (
                    <ShoppingBag aria-hidden className="size-5" />
                  )}
                  {t === "delivery" ? tx.delivery : tx.pickup}
                </button>
              ))}
            </div>
          </header>

          {deals.length && !q ? (
            <section
              aria-label={tx.deals}
              className="px-4 pt-4"
              data-testid="deals"
            >
              <h2 className="mb-2 text-lg font-bold">{tx.deals}</h2>
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                {deals.map((o) => {
                  const item = items.get(o.menuItemId)!;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex w-64 shrink-0 flex-col items-start rounded-card border-2 border-brand-200 bg-brand-50 p-3 text-start"
                    >
                      <span className="font-bold text-brand-800">
                        {pick(lang, o.title, o.titleUr)}
                      </span>
                      {o.description ? (
                        <span className="line-clamp-2 text-sm text-muted">
                          {o.description}
                        </span>
                      ) : null}
                      <span className="mt-1 font-bold" dir="ltr">
                        {priceText(item, lang)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="sticky top-0 z-20 border-b border-line bg-surface">
            <div className="px-4 pt-3">
              <label className="flex min-h-touch items-center gap-2 rounded-control border border-line-strong bg-surface px-3">
                <Search aria-hidden className="size-5 text-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tx.search}
                  aria-label={tx.search}
                  className="min-h-touch flex-1 bg-transparent text-base outline-none"
                />
              </label>
            </div>
            <CategoryTabs
              categories={categories.map((c) => ({
                id: c.id,
                label: pick(lang, c.name, c.nameUr),
              }))}
            />
          </div>

          {categories.length === 0 ? (
            <p className="p-6 text-center text-muted">{tx.noResults}</p>
          ) : null}
          {categories.map((c, ci) => (
            // Each category hydrates on its own (React yields between them: no long task on cheap phones).
            <Suspense key={c.id} fallback={null}>
              <section
                id={`cat-${c.id}`}
                aria-labelledby={`h-${c.id}`}
                // Off-screen categories skip layout/paint until scrolled near (cheap phones).
                className={`scroll-mt-32 px-4 pt-5 ${ci > 0 ? "[content-visibility:auto] [contain-intrinsic-size:auto_640px]" : ""}`}
              >
                <h2 id={`h-${c.id}`} className="text-xl font-bold">
                  {pick(lang, c.name, c.nameUr)}
                </h2>
                <ul>
                  {c.items.map((i) => (
                    <ItemCard
                      key={i.id}
                      item={i}
                      lang={lang}
                      count={inCart(i.id)}
                      onOpen={() => openItem(i)}
                    />
                  ))}
                </ul>
              </section>
            </Suspense>
          ))}

          {count > 0 ? (
            <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg border-t border-line bg-surface/95 p-3">
              <button
                type="button"
                onClick={() => setView("cart")}
                className="flex h-touch-lg w-full items-center gap-3 rounded-card bg-brand-700 px-4 text-lg font-bold text-white"
                data-testid="cart-bar"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-white text-brand-700">
                  {count}
                </span>
                <span className="flex-1 text-start" dir="auto">
                  {tx.items(count)} · <span dir="ltr">{rs(subtotal)}</span>
                </span>
                <span>{tx.viewOrder}</span>
                <ChevronRight aria-hidden className="size-5 rtl:rotate-180" />
              </button>
            </div>
          ) : null}
          {sent ? (
            <SentBanner sent={sent} lang={lang} onClose={() => setSent(null)} />
          ) : null}
        </>
      ) : (
        <CartView
          lang={lang}
          data={data}
          state={state}
          branch={branch}
          cart={cart}
          priced={priced}
          totals={totals.ok ? totals.totals : null}
          belowMinimum={belowMinimum}
          problems={problems}
          error={error}
          canSend={canSend}
          sending={sending}
          sent={sent}
          onBack={() => setView("menu")}
          onOrderType={setOrderType}
          onQuantity={(key, quantity) =>
            setLines((ls) =>
              ls.map((l) =>
                l.key === key
                  ? { ...l, quantity: Math.max(1, Math.min(99, quantity)) }
                  : l,
              ),
            )
          }
          onRemove={(key) => setLines((ls) => ls.filter((l) => l.key !== key))}
          onEdit={(line) => {
            const item = items.get(line.itemId);
            if (item) setSheet({ item, editing: line });
          }}
          onSend={send}
        />
      )}

      {sheet ? (
        <ItemSheet
          key={sheet.editing?.key ?? sheet.item.id}
          item={sheet.item}
          lang={lang}
          restaurantId={rid}
          branchId={data.branchId}
          editing={sheet.editing}
          canOrder={sheet.item.isAvailable}
          onClose={() => setSheet(null)}
          onSave={(line) => {
            setLines((ls) => addLine(ls, line, sheet.editing?.key));
            setSent(null);
            setSheet(null);
          }}
        />
      ) : null}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** "Rs 550" or "from Rs 899" — engine prices from the branch menu. */
function priceText(item: PageItem, lang: PageLang) {
  const tx = texts(lang);
  if (item.sizes.length && item.fromPrice != null)
    return tx.from(rs(item.fromPrice));
  return item.price != null ? rs(item.price) : "";
}

function ItemCard({
  item,
  lang,
  count,
  onOpen,
}: {
  item: PageItem;
  lang: PageLang;
  count: number;
  onOpen: () => void;
}) {
  const tx = texts(lang);
  const soldOut = !item.isAvailable;
  return (
    <li
      className="border-b border-line py-4 last:border-0"
      data-testid="menu-item"
      data-item={item.name}
    >
      <div className={`flex gap-3 ${soldOut ? "opacity-60" : ""}`}>
        <button
          type="button"
          onClick={onOpen}
          disabled={soldOut}
          className="min-w-0 flex-1 text-start"
          aria-label={`${pick(lang, item.name, item.nameUr)} ${priceText(item, lang)}`}
        >
          <span className="block text-lg font-bold">
            {pick(lang, item.name, item.nameUr)}
          </span>
          {item.bestseller && !soldOut ? (
            <span className="mt-0.5 inline-block rounded-md bg-status-awaiting-bg px-2 text-xs font-bold text-status-awaiting-fg">
              ★ {tx.bestseller}
            </span>
          ) : null}
          {item.description ? (
            <span className="mt-0.5 line-clamp-2 block text-muted">
              {pick(lang, item.description, item.descriptionUr)}
            </span>
          ) : null}
          {soldOut ? (
            <span className="mt-1 inline-block rounded-md bg-subtle px-2 py-0.5 text-sm font-semibold text-muted">
              {tx.soldOut}
            </span>
          ) : (
            <span className="mt-1 block text-lg font-bold" dir="ltr">
              {priceText(item, lang)}
            </span>
          )}
        </button>
        <div className="relative size-28 shrink-0">
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt=""
              width={112}
              height={112}
              sizes="112px"
              loading="lazy"
              className={`size-28 rounded-card object-cover ${soldOut ? "grayscale" : ""}`}
            />
          ) : (
            <div
              className={`flex size-28 items-center justify-center rounded-card text-2xl font-bold ${soldOut ? "bg-subtle text-muted" : "bg-brand-50 text-brand-700"}`}
              aria-hidden
            >
              {initials(item.name)}
            </div>
          )}
          {!soldOut ? (
            <button
              type="button"
              onClick={onOpen}
              aria-label={`${tx.add} ${pick(lang, item.name, item.nameUr)}`}
              className={`absolute -bottom-2 -end-2 flex size-touch-lg items-center justify-center rounded-full text-lg font-bold shadow-raised ${count ? "border-2 border-brand-700 bg-surface text-brand-700" : "bg-brand-700 text-white"}`}
            >
              {count ? count : <Plus aria-hidden className="size-6" />}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function CategoryTabs({
  categories,
}: {
  categories: { id: string; label: string }[];
}) {
  const [active, setActive] = useState(categories[0]?.id ?? "");
  const ids = categories.map((c) => c.id).join(",");
  useEffect(() => {
    const sections = ids
      .split(",")
      .map((id) => document.getElementById(`cat-${id}`))
      .filter((x): x is HTMLElement => !!x);
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (top) setActive(top.target.id.slice(4));
      },
      { rootMargin: "-130px 0px -60% 0px" },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [ids]);
  return (
    <nav className="flex gap-1 overflow-x-auto px-2" aria-label="Categories">
      {categories.map((c) => (
        <a
          key={c.id}
          href={`#cat-${c.id}`}
          onClick={() => setActive(c.id)}
          aria-current={active === c.id ? "true" : undefined}
          className={`flex min-h-touch shrink-0 items-center border-b-[3px] px-3 font-semibold ${active === c.id ? "border-brand-700 text-brand-700" : "border-transparent text-muted"}`}
        >
          {c.label}
        </a>
      ))}
    </nav>
  );
}

function SentBanner({
  sent,
  lang,
  onClose,
}: {
  sent: Sent;
  lang: PageLang;
  onClose: () => void;
}) {
  const tx = texts(lang);
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg border-t border-line bg-surface p-4"
      data-testid="sent-banner"
    >
      <p className="font-bold">{tx.message(sent.code)}</p>
      <div className="mt-2 flex gap-2">
        {sent.link ? (
          <a
            href={sent.link}
            className="flex h-touch-lg flex-1 items-center justify-center gap-2 rounded-card bg-whatsapp font-bold text-white"
          >
            <MessageCircle aria-hidden className="size-5" /> {tx.send}
          </a>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="h-touch-lg rounded-card border border-line-strong px-4"
        >
          {tx.close}
        </button>
      </div>
    </div>
  );
}

type Priced = {
  line: PageCartLine;
  item: PageItem | undefined;
  result: ReturnType<typeof priceLine>;
};

function CartView(props: {
  lang: PageLang;
  data: PublicMenu;
  state: PageState;
  branch: PublicMenu["branches"][number];
  cart: PageCart;
  priced: Priced[];
  totals: { subtotal: number; deliveryFee: number; total: number } | null;
  belowMinimum: boolean;
  problems: Problem[];
  error: string | null;
  canSend: boolean;
  sending: boolean;
  sent: Sent | null;
  onBack: () => void;
  onOrderType: (t: OrderType) => void;
  onQuantity: (key: string, q: number) => void;
  onRemove: (key: string) => void;
  onEdit: (line: PageCartLine) => void;
  onSend: () => void;
}) {
  const { lang, data, state, branch, cart, priced, totals } = props;
  const tx = texts(lang);
  const delivery = cart.orderType === "delivery";
  const blocked = !state.isOpen
    ? tx.closedNow(state.opensAt ? tx.opensAt(state.opensAt) : null)
    : !data.whatsappNumber
      ? tx.noWhatsApp
      : null;

  return (
    <div data-testid="cart-view">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-3">
        <button
          type="button"
          onClick={props.onBack}
          aria-label={tx.back}
          className="flex size-touch items-center justify-center"
        >
          <ChevronLeft aria-hidden className="size-6 rtl:rotate-180" />
        </button>
        <div>
          <h1 className="text-xl font-bold">{tx.yourOrder}</h1>
          <p className="text-sm text-muted">
            {data.restaurant.name} · {branch.name}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3 p-4">
        {props.sent && !cart.lines.length ? (
          <SentInline sent={props.sent} lang={lang} />
        ) : null}
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
          {delivery ? (
            <Bike aria-hidden className="size-6 text-brand-700" />
          ) : (
            <ShoppingBag aria-hidden className="size-6 text-brand-700" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {delivery ? tx.delivery : tx.pickup} ·{" "}
              <Clock3 aria-hidden className="inline size-4" />{" "}
              {delivery
                ? `${state.deliveryRange[0]}–${state.deliveryRange[1]}`
                : `~${state.prepMinutes}`}{" "}
              min
            </p>
            <p className="text-sm text-muted">
              {delivery ? tx.sharesAddress : tx.pickupFrom(branch.name)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => props.onOrderType(delivery ? "pickup" : "delivery")}
            className="min-h-touch px-2 font-semibold text-brand-700"
          >
            {tx.change}
          </button>
        </div>

        {cart.lines.length === 0 ? (
          <p className="rounded-card border border-line bg-surface p-6 text-center text-muted">
            {tx.emptyCart}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {priced.map(({ line, item, result }) => {
              const problem =
                props.problems.find((p) => p.key === line.key)?.message ??
                (!result
                  ? tx.unavailable
                  : !result.ok
                    ? result.errors[0].message
                    : null);
              const r = result?.ok ? result.line : null;
              const editable =
                !!item &&
                (item.sizes.length > 0 ||
                  item.groups.length > 0 ||
                  item.removableOptions.length > 0);
              return (
                <li key={line.key} className="p-4" data-testid="cart-line">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">
                        {item ? pick(lang, item.name, item.nameUr) : "—"}
                      </p>
                      {r && (r.sizeName || r.options.length) ? (
                        <p className="text-sm text-muted">
                          {[
                            r.sizeName
                              ? pick(
                                  lang,
                                  r.sizeName,
                                  item?.sizes.find((s) => s.id === r.variantId)
                                    ?.nameUr,
                                )
                              : null,
                            ...r.options.map(
                              (o) => `+ ${pick(lang, o.name, o.nameUr)}`,
                            ),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                      {line.removals.length ? (
                        <p className="text-sm font-semibold text-status-cancelled-fg">
                          {line.removals.map((x) => tx.no(x)).join(", ")}
                        </p>
                      ) : null}
                      {line.notes ? (
                        <p className="text-sm italic text-muted">
                          “{line.notes}”
                        </p>
                      ) : null}
                      {problem ? (
                        <p
                          role="alert"
                          className="mt-1 text-sm font-semibold text-danger"
                        >
                          {problem}
                        </p>
                      ) : null}
                    </div>
                    <p className="font-bold" dir="ltr">
                      {r ? rs(r.lineTotal) : ""}
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div
                      className="flex items-center rounded-card border border-line-strong"
                      dir="ltr"
                    >
                      <button
                        type="button"
                        aria-label="−"
                        onClick={() =>
                          props.onQuantity(line.key, line.quantity - 1)
                        }
                        className="flex size-touch items-center justify-center"
                      >
                        <Minus aria-hidden className="size-5" />
                      </button>
                      <span className="w-8 text-center font-semibold">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="+"
                        onClick={() =>
                          props.onQuantity(line.key, line.quantity + 1)
                        }
                        className="flex size-touch items-center justify-center"
                      >
                        <Plus aria-hidden className="size-5" />
                      </button>
                    </div>
                    {editable ? (
                      <button
                        type="button"
                        onClick={() => props.onEdit(line)}
                        className="min-h-touch px-2 font-semibold text-brand-700"
                      >
                        {tx.edit}
                      </button>
                    ) : null}
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => props.onRemove(line.key)}
                      className="min-h-touch px-2 font-semibold text-danger"
                    >
                      {tx.remove}
                    </button>
                  </div>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={props.onBack}
                className="flex min-h-touch-lg w-full items-center justify-center gap-2 font-bold text-brand-700"
              >
                <Plus aria-hidden className="size-5" /> {tx.addMore}
              </button>
            </li>
          </ul>
        )}

        {cart.lines.length && totals ? (
          <div
            className="rounded-card border border-line bg-surface p-4"
            data-testid="cart-totals"
          >
            <p className="flex justify-between">
              <span className="text-muted">{tx.subtotal}</span>
              <span dir="ltr">{rs(totals.subtotal)}</span>
            </p>
            {delivery ? (
              <p className="mt-1 flex justify-between">
                <span className="text-muted">{tx.deliveryFee}</span>
                <span dir="ltr">{rs(totals.deliveryFee)}</span>
              </p>
            ) : null}
            <p className="mt-2 flex justify-between border-t border-dashed border-line-strong pt-2 text-xl font-bold">
              <span>{tx.total}</span>
              <span dir="ltr">{rs(totals.total)}</span>
            </p>
            {props.belowMinimum ? (
              <p className="mt-2 rounded-control bg-status-awaiting-bg p-2 text-sm font-semibold text-status-awaiting-fg">
                {tx.minimum(rs(branch.minimumOrder))}
              </p>
            ) : null}
            <p className="mt-2 text-sm text-muted">{tx.finalOnWhatsApp}</p>
          </div>
        ) : null}
      </div>

      {cart.lines.length ? (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg border-t border-line bg-surface p-3">
          {props.error || blocked ? (
            <p
              role="alert"
              className="mb-2 text-center text-sm font-semibold text-danger"
              data-testid="send-blocked"
            >
              {props.error ?? blocked}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!props.canSend}
            onClick={props.onSend}
            className="flex h-touch-lg w-full items-center justify-center gap-2 rounded-card bg-whatsapp text-lg font-bold text-white disabled:bg-line disabled:text-muted"
          >
            <MessageCircle aria-hidden className="size-6" />
            {props.sending ? tx.sending : tx.send}
          </button>
          <p className="mt-1 text-center text-xs text-muted">{tx.sendNote}</p>
        </div>
      ) : null}
    </div>
  );
}

function SentInline({ sent, lang }: { sent: Sent; lang: PageLang }) {
  const tx = texts(lang);
  return (
    <div
      className="rounded-card border-2 border-status-ready-border bg-status-ready-bg p-4"
      data-testid="sent-inline"
    >
      <p className="font-bold">{tx.message(sent.code)}</p>
      {sent.link ? (
        <a
          href={sent.link}
          className="mt-2 flex h-touch-lg items-center justify-center gap-2 rounded-card bg-whatsapp font-bold text-white"
        >
          <MessageCircle aria-hidden className="size-5" /> {tx.send}
        </a>
      ) : null}
    </div>
  );
}
