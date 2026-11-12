import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bike,
  Bot,
  ChartColumn,
  ChefHat,
  Download,
  Minus,
  ShoppingBag,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPKR } from "@/lib/money";
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, type OrderType, type PaymentMethod } from "@/lib/orders/constants";
import { CHANNEL_LABELS } from "@/lib/reports/labels";
import { percentChange, shortDate, weekdayName } from "@/lib/reports/range";
import type { Overview, ReportData } from "@/lib/reports/queries";
import { hourLabel, peakWindow, hourWindowLabel } from "@/lib/reports/summary";
import { cn } from "@/lib/utils";
import { SalesChart, type SalesBar } from "./sales-chart";

/**
 * /reports body (Phase 11). Server component: only the controls and the
 * sales chart run in the browser. Every number comes from the report RPCs.
 */
export function ReportsView({ data, today, exportQuery }: { data: ReportData; today: string; exportQuery: string }) {
  const { current: cur, previous: prev, range } = data;
  const aov = cur.orders ? Math.round(cur.sales / cur.orders) : 0;
  const prevAov = prev.orders ? Math.round(prev.sales / prev.orders) : 0;
  const cancelRate = rate(cur.cancelled, cur.received);
  const vs = range.compareLabel;

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <SummaryBanner data={data} />

      {/* 1. Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Total sales" value={formatPKR(cur.sales)}>
          <Delta current={cur.sales} previous={prev.sales} mode="percent" vs={vs} />
        </StatCard>
        <StatCard label="Orders" value={cur.orders.toLocaleString("en-PK")} note={cur.open ? `+ ${cur.open} still in progress` : undefined}>
          <Delta current={cur.orders} previous={prev.orders} mode="diff" vs={vs} />
        </StatCard>
        <StatCard label="Average order" value={formatPKR(aov)}>
          <Delta current={aov} previous={prevAov} mode="percent" vs={vs} />
        </StatCard>
        <StatCard label="Cancelled orders" value={cur.cancelled.toLocaleString("en-PK")} note={cur.received ? `${cancelRate}% of orders` : undefined}>
          <Delta current={cur.cancelled} previous={prev.cancelled} mode="diff" vs={vs} goodWhen="down" />
        </StatCard>
      </div>

      {/* 2 + 6. Sales by day, order types */}
      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <Card padding="lg" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{range.days < 7 ? "Sales — last 7 days" : "Sales by day"}</CardTitle>
            <span className="text-sm text-muted">Rupees</span>
          </CardHeader>
          {data.daily.every((d) => d.sales === 0) ? <Empty>No sales in these days yet.</Empty> : <SalesChart bars={salesBars(data, today)} />}
        </Card>
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Delivery, pickup, dine-in</CardTitle>
          </CardHeader>
          <TypeSplit overview={cur} />
        </Card>
      </div>

      {/* 4 + 3. Top items, busiest hours */}
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Best sellers</CardTitle>
            {data.topItems.length ? <DownloadLink href={`/api/reports/export?type=items&${exportQuery}`} label="CSV" /> : null}
          </CardHeader>
          {data.topItems.length === 0 ? (
            <Empty>No items sold in this period yet.</Empty>
          ) : (
            <ol className="flex flex-col gap-3" data-testid="top-items">
              {data.topItems.map((item, i) => (
                <li key={item.itemId} className="flex items-start gap-3">
                  <Rank n={i + 1} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold">{item.name}</span>
                      <span className="shrink-0 font-bold">{formatPKR(item.revenue)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <Meter value={item.qty} max={data.topItems[0].qty} />
                      <span className="shrink-0 text-sm text-muted">{item.qty} sold</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {data.slowItems.length ? (
            <div className="mt-5 border-t border-line pt-4">
              <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Slowest sellers</h4>
              <ul className="flex flex-col gap-1.5 text-sm" data-testid="slow-items">
                {data.slowItems.map((item) => (
                  <li key={item.itemId} className="flex justify-between gap-2">
                    <span className="truncate">{item.name}</span>
                    <span className={cn("shrink-0", item.qty === 0 ? "font-semibold text-danger" : "text-muted")}>
                      {item.qty === 0 ? "None sold" : `${item.qty} sold`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
        <Card padding="lg">
          <BusiestHours hours={data.hours} />
        </Card>
      </div>

      {/* 5 + 7. Where orders came from, payment methods */}
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Where orders came from</CardTitle>
          </CardHeader>
          <SplitList rows={cur.byChannel} total={cur.orders} label={(k) => CHANNEL_LABELS[k] ?? k} testId="channels" />
        </Card>
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Payment methods</CardTitle>
          </CardHeader>
          <SplitList rows={cur.byPayment} total={cur.orders} label={(k) => PAYMENT_METHOD_LABELS[k as PaymentMethod] ?? k} showSales testId="payments" />
        </Card>
      </div>

      {/* 8 + 9. Cancellations, speed */}
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Cancellations</CardTitle>
            <span className="text-sm text-muted">
              {cur.cancelled} cancelled · {cur.failed} failed
            </span>
          </CardHeader>
          {cur.cancelReasons.length === 0 ? (
            <Empty>No cancelled or failed orders. 👍</Empty>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="cancel-reasons">
              {cur.cancelReasons.map((r) => (
                <li key={`${r.status}-${r.reason}`} className="flex items-center justify-between gap-3 rounded-control bg-subtle px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-semibold">{r.label}</span>
                    <span className="block text-xs text-muted">{r.status === "failed" ? "Delivery failed" : "Cancelled"}</span>
                  </span>
                  <span className="text-lg font-bold">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Kitchen and delivery speed</CardTitle>
          </CardHeader>
          {cur.orders === 0 ? (
            <Empty>No finished orders in this period yet.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Tile icon={<ChefHat />} label="Average cooking time" value={minutes(cur.prepMinutes)} hint="Accepted → ready" />
              <Tile icon={<Bike />} label="Average delivery time" value={minutes(cur.deliveryMinutes)} hint="Left → delivered" />
              <Tile icon={<Timer />} label="Late orders" value={String(cur.late)} hint="Took longer than your late time" tone={cur.late ? "bad" : undefined} />
            </div>
          )}
        </Card>
      </div>

      {/* 10. Riders */}
      <Card padding="lg">
        <CardHeader>
          <CardTitle>Riders</CardTitle>
          {data.riders.length ? <DownloadLink href={`/api/reports/export?type=riders&${exportQuery}`} label="CSV" /> : null}
        </CardHeader>
        {data.riders.length === 0 ? (
          <Empty>No rider deliveries in this period yet.</Empty>
        ) : (
          <Table
            testId="riders-table"
            head={["Rider", "Deliveries", "Avg time", "Failed", "Cash collected"]}
            rows={data.riders.map((r) => [
              <span key="n" className="font-semibold">{r.name}</span>,
              r.deliveries,
              minutes(r.avgMinutes),
              <span key="f" className={r.failed ? "font-semibold text-danger" : undefined}>{r.failed}</span>,
              formatPKR(r.cashCollected),
            ])}
          />
        )}
      </Card>

      {/* 11. Customers */}
      <Card padding="lg">
        <CardHeader>
          <CardTitle>Customers</CardTitle>
        </CardHeader>
        {cur.customers.total === 0 ? (
          <Empty>No customer orders in this period yet.</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Tile icon={<Users />} label="New customers" value={String(cur.customers.new)} hint="First order ever" />
              <Tile icon={<Users />} label="Returning customers" value={String(cur.customers.total - cur.customers.new)} hint="Ordered before" />
              <Tile
                icon={<Users />}
                label="Ordered 2+ times"
                value={`${rate(cur.customers.repeat, cur.customers.total)}%`}
                hint={`${cur.customers.repeat} of ${cur.customers.total} customers`}
              />
            </div>
            {data.topCustomers.length ? (
              <div>
                <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Top customers</h4>
                <Table
                  testId="top-customers"
                  head={["#", "Customer", "Phone", "Orders", "Spent"]}
                  rows={data.topCustomers.map((c, i) => [
                    i + 1,
                    <span key="n" className="font-semibold">{c.name || "No name"}</span>,
                    <span key="p" className="whitespace-nowrap text-muted">{c.phoneMasked ?? "—"}</span>,
                    c.orders,
                    formatPKR(c.spent),
                  ])}
                />
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* 12. WhatsApp bot + menu page */}
      <Card padding="lg">
        <CardHeader>
          <CardTitle>WhatsApp bot</CardTitle>
        </CardHeader>
        <BotSection bot={data.bot} />
      </Card>

      {/* 13. Branch comparison */}
      {data.branches ? (
        <Card padding="none" className="overflow-hidden">
          <div className="p-4 lg:p-6">
            <CardTitle>Branches</CardTitle>
          </div>
          {data.branches.every((b) => b.received === 0) ? (
            <div className="px-4 pb-6 lg:px-6">
              <Empty>No orders in this period yet.</Empty>
            </div>
          ) : (
            <Table
              flush
              testId="branches-table"
              head={["Branch", "Orders", "Sales", "Avg order", "Cancelled", `vs ${shortCompare(vs)}`]}
              rows={data.branches.map((b) => {
                const change = percentChange(b.sales, b.previousSales);
                const cr = rate(b.cancelled, b.received);
                return [
                  <span key="n" className="font-semibold">{b.name}</span>,
                  b.orders,
                  <span key="s" className="font-bold">{formatPKR(b.sales)}</span>,
                  formatPKR(b.orders ? Math.round(b.sales / b.orders) : 0),
                  <span key="c" className={cr >= 10 ? "font-semibold text-danger" : undefined}>
                    {b.cancelled}
                    {b.received ? <span className="text-muted"> · {cr}%</span> : null}
                  </span>,
                  <ChangeText key="v" change={change} />,
                ];
              })}
            />
          )}
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function rate(part: number, total: number) {
  return total ? Math.round((part / total) * 100) : 0;
}

function minutes(m: number | null) {
  if (m === null || Number.isNaN(m)) return "—";
  return `${Math.round(m)} min`;
}

function shortCompare(label: string) {
  return label.replace(/^the /, "");
}

function SummaryBanner({ data }: { data: ReportData }) {
  const { summary } = data;
  const Icon = summary.tone === "up" ? TrendingUp : summary.tone === "down" ? TrendingDown : summary.tone === "empty" ? ChartColumn : Minus;
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-card border p-4 lg:p-5",
        summary.tone === "down" ? "border-line bg-subtle" : "border-brand-200 bg-brand-50",
      )}
      data-testid="report-summary"
    >
      <span
        aria-hidden
        className={cn(
          "hidden size-12 shrink-0 items-center justify-center rounded-full text-white sm:flex [&_svg]:size-6",
          summary.tone === "down" ? "bg-muted" : "bg-brand-700",
        )}
      >
        <Icon />
      </span>
      <p className="text-base text-brand-800 lg:text-lg">
        {summary.parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}
      </p>
    </div>
  );
}

function StatCard({ label, value, note, children }: { label: string; value: string; note?: string; children: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-1">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="truncate text-2xl font-bold lg:text-3xl">{value}</p>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      <div className="text-sm">{children}</div>
    </Card>
  );
}

/** "▲ 12% vs last Friday", "▼ 1 fewer (good)". Color = good/bad, not up/down. */
function Delta({
  current,
  previous,
  mode,
  vs,
  goodWhen = "up",
}: {
  current: number;
  previous: number;
  mode: "percent" | "diff";
  vs: string;
  goodWhen?: "up" | "down";
}) {
  if (mode === "percent" && previous <= 0) {
    return <span className="text-muted">Nothing to compare with {vs}</span>;
  }
  const diff = current - previous;
  if (diff === 0) {
    return (
      <span className="flex items-center gap-1 text-muted">
        <Minus aria-hidden className="size-4" /> Same as {vs}
      </span>
    );
  }
  const up = diff > 0;
  const good = up === (goodWhen === "up");
  const Icon = up ? ArrowUp : ArrowDown;
  const text =
    mode === "percent"
      ? `${Math.abs(percentChange(current, previous) ?? 0)}% ${up ? "more" : "less"} than ${vs}`
      : `${Math.abs(diff)} ${up ? "more" : "fewer"} ${goodWhen === "down" && good ? "(good)" : `than ${vs}`}`;
  return (
    <span className={cn("flex items-start gap-1 font-medium", good ? "text-status-ready-fg" : "text-danger")}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </span>
  );
}

function ChangeText({ change }: { change: number | null }) {
  if (change === null) return <span className="text-muted">—</span>;
  if (change === 0) return <span className="text-muted">Same</span>;
  const up = change > 0;
  return (
    <span className={cn("flex items-center gap-1 font-semibold", up ? "text-status-ready-fg" : "text-danger")}>
      {up ? <ArrowUp aria-hidden className="size-4" /> : <ArrowDown aria-hidden className="size-4" />}
      {Math.abs(change)}%
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-control border-2 border-dashed border-line px-4 py-6 text-center text-muted">{children}</p>;
}

function Rank({ n }: { n: number }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
        n === 1 ? "bg-brand-700 text-white" : "bg-subtle text-ink",
      )}
    >
      {n}
    </span>
  );
}

function Meter({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <span className={cn("block h-2 flex-1 overflow-hidden rounded-full bg-subtle", className)} aria-hidden>
      <span className="block h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
    </span>
  );
}

function Tile({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: "bad" }) {
  return (
    <div className="rounded-control bg-subtle p-3">
      <p className="flex items-center gap-1.5 text-sm text-muted [&_svg]:size-4">
        <span aria-hidden>{icon}</span>
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold", tone === "bad" && "text-danger")}>{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function DownloadLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} download className={buttonVariants({ variant: "secondary" })} aria-label={`Download ${label}`}>
      <Download aria-hidden /> {label}
    </a>
  );
}

const TYPE_STYLE: Record<OrderType, { color: string; icon: ReactNode }> = {
  delivery: { color: "bg-brand-700", icon: <Bike /> },
  pickup: { color: "bg-brand-200", icon: <ShoppingBag /> },
  dine_in: { color: "bg-status-accepted-border", icon: <UtensilsCrossed /> },
};

function TypeSplit({ overview }: { overview: Overview }) {
  const total = overview.orders;
  if (total === 0) return <Empty>No orders in this period yet.</Empty>;
  const rows = (["delivery", "pickup", "dine_in"] as OrderType[])
    .map((k) => ({ key: k, orders: overview.byType.find((x) => x.key === k)?.orders ?? 0 }))
    .filter((r) => r.orders > 0);
  return (
    <div className="flex flex-col gap-4" data-testid="type-split">
      <div className="flex h-10 overflow-hidden rounded-full bg-subtle" aria-hidden>
        {rows.map((r) => (
          <span key={r.key} className={TYPE_STYLE[r.key].color} style={{ width: `${(r.orders / total) * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3">
            <span aria-hidden className={cn("size-4 shrink-0 rounded", TYPE_STYLE[r.key].color)} />
            <span aria-hidden className="text-muted [&_svg]:size-5">{TYPE_STYLE[r.key].icon}</span>
            <span className="flex-1 font-semibold">{ORDER_TYPE_LABELS[r.key]}</span>
            <span className="font-bold">
              {r.orders} · {rate(r.orders, total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SplitList({
  rows,
  total,
  label,
  showSales,
  testId,
}: {
  rows: { key: string; orders: number; sales: number }[];
  total: number;
  label: (key: string) => string;
  showSales?: boolean;
  testId: string;
}) {
  if (total === 0 || rows.length === 0) return <Empty>No orders in this period yet.</Empty>;
  const max = Math.max(...rows.map((r) => r.orders));
  return (
    <ul className="flex flex-col gap-3" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{label(r.key)}</span>
            <span className="text-sm">
              <strong>{r.orders}</strong> <span className="text-muted">· {rate(r.orders, total)}%</span>
              {showSales ? <span className="text-muted"> · {formatPKR(r.sales)}</span> : null}
            </span>
          </div>
          <Meter value={r.orders} max={max} className="mt-1" />
        </li>
      ))}
    </ul>
  );
}

function BusiestHours({ hours }: { hours: number[] }) {
  const peak = peakWindow(hours, 1);
  const header = (
    <CardHeader>
      <CardTitle>Busiest hours</CardTitle>
      {peak ? <span className="text-sm font-semibold text-brand-700">Peak: {hourLabel(peak.start)}–{hourLabel(peak.start + 1)}</span> : null}
    </CardHeader>
  );
  if (!peak) {
    return (
      <>
        {header}
        <Empty>No orders in this period yet.</Empty>
      </>
    );
  }
  // Show from the first to the last hour with orders (at least 8 hours wide).
  let first = hours.findIndex((n) => n > 0);
  let last = 23 - [...hours].reverse().findIndex((n) => n > 0);
  while (last - first + 1 < 8) {
    if (first > 0) first--;
    if (last - first + 1 < 8 && last < 23) last++;
  }
  const shown = hours.slice(first, last + 1).map((n, i) => ({ hour: first + i, n }));
  const max = Math.max(...hours);
  const window2 = peakWindow(hours, 2);
  return (
    <>
      {header}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }} data-testid="busy-hours">
        {shown.map(({ hour, n }) => {
          const level = n === 0 ? 0 : n / max;
          return (
            <div key={hour} className="flex min-w-0 flex-col items-center gap-1">
              <span
                title={`${hourLabel(hour)}: ${n} order${n === 1 ? "" : "s"}`}
                className={cn(
                  "flex h-12 w-full items-center justify-center rounded-md text-xs font-bold sm:text-sm",
                  level === 0 && "bg-subtle text-muted",
                  level > 0 && level < 0.34 && "bg-brand-50 text-brand-800",
                  level >= 0.34 && level < 0.67 && "bg-brand-200 text-brand-800",
                  level >= 0.67 && level < 1 && "bg-brand-600 text-white",
                  level === 1 && "bg-brand-800 text-white ring-2 ring-ink ring-offset-1",
                )}
              >
                <span className={cn(shown.length > 12 && "hidden sm:inline")}>{n}</span>
              </span>
              <span className={cn("text-[11px] text-muted", (hour - first) % 3 !== 0 && "hidden sm:block", level === 1 && "font-bold text-brand-700")}>
                {hourLabel(hour).replace(" AM", "a").replace(" PM", "p")}
              </span>
            </div>
          );
        })}
      </div>
      {window2 ? (
        <p className="mt-4 rounded-control bg-subtle px-3 py-2 text-sm">
          Most orders came between {hourWindowLabel(window2.start)}. Keep enough staff and riders free then.
        </p>
      ) : null}
    </>
  );
}

function BotSection({ bot }: { bot: ReportData["bot"] }) {
  if (bot.conversations === 0 && bot.botOrders === 0 && bot.menuViews === 0 && bot.cartsSent === 0) {
    return <Empty>No WhatsApp bot chats in this period yet.</Empty>;
  }
  const conversion = rate(bot.botOrders, bot.conversations);
  const funnel = [
    { label: "Menu page views", value: bot.menuViews },
    { label: "Carts sent to WhatsApp", value: bot.cartsSent },
    { label: "Orders confirmed", value: bot.cartOrders },
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="bot-stats">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Bot />} label="Bot chats" value={String(bot.conversations)} />
        <Tile icon={<Bot />} label="Orders by the bot" value={String(bot.botOrders)} hint={`${bot.botSalesOrders} delivered or completed`} />
        <Tile icon={<Bot />} label="Chats that ordered" value={`${conversion}%`} hint={bot.conversations ? `${bot.botOrders} of ${bot.conversations} chats` : undefined} />
        <Tile icon={<Users />} label="Handed to staff" value={String(bot.handoffs)} tone={bot.handoffs > 0 && bot.handoffs >= bot.conversations / 3 ? "bad" : undefined} />
      </div>
      <div>
        <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Menu page</h4>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {funnel.map((f, i) => (
            <li key={f.label} className="flex items-center justify-between gap-2 rounded-control border border-line p-3">
              <span className="text-sm text-muted">{f.label}</span>
              <span className="text-right">
                <span className="text-xl font-bold">{f.value}</span>
                {i > 0 && funnel[i - 1].value > 0 ? <span className="block text-xs text-muted">{rate(f.value, funnel[i - 1].value)}% of previous</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Table({ head, rows, testId, flush }: { head: string[]; rows: ReactNode[][]; testId: string; flush?: boolean }) {
  return (
    <div className="-mx-4 overflow-x-auto lg:mx-0" data-testid={testId}>
      <table className="w-full min-w-[32rem] border-collapse text-left">
        <thead>
          <tr className="bg-subtle text-xs font-bold uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={h} scope="col" className={cn("px-4 py-3", i === 0 && !flush && "lg:pl-3")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function salesBars(data: ReportData, today: string): SalesBar[] {
  const n = data.daily.length;
  const best = Math.max(...data.daily.map((d) => d.sales));
  return data.daily.map((d, i) => ({
    day: d.day,
    label: n <= 7 ? (d.day === today ? "Today" : weekdayName(d.day, "short")) : shortDate(d.day),
    sales: d.sales,
    orders: d.orders,
    highlight: data.range.days === 1 ? d.day === data.range.to : n <= 7 ? i === n - 1 : d.sales === best && best > 0,
  }));
}
