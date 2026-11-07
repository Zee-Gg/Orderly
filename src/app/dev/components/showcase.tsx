"use client";

import { useState, type ReactNode } from "react";
import {
  Bike,
  BookOpen,
  Camera,
  Check,
  ClipboardList,
  Clock,
  MapPin,
  Phone,
  Plus,
  Printer,
  Search,
  TriangleAlert,
} from "lucide-react";
import { formatPKR } from "@/lib/money";
import {
  ORDER_SOURCES,
  ORDER_STATUSES,
  ORDER_TYPES,
  PAYMENT_KINDS,
} from "@/lib/orders/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { OrderTypeBadge } from "@/components/ui/order-type-badge";
import { PaymentBadge } from "@/components/ui/payment-badge";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";
import { SourceBadge } from "@/components/ui/source-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { UrduText } from "@/components/ui/urdu-text";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-surface p-5 lg:p-6">
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const SWATCHES = [
  ["brand-50", "bg-brand-50"],
  ["brand-100", "bg-brand-100"],
  ["brand-600", "bg-brand-600"],
  ["brand-700 · primary", "bg-brand-700"],
  ["brand-800 · hover", "bg-brand-800"],
  ["page", "bg-page"],
  ["subtle", "bg-subtle"],
  ["line", "bg-line"],
  ["line-strong", "bg-line-strong"],
  ["muted", "bg-muted"],
  ["ink", "bg-ink"],
  ["whatsapp", "bg-whatsapp"],
  ["danger", "bg-danger"],
  ["urgent", "bg-urgent"],
] as const;

const REJECT_REASONS = [
  "Suspected fake order",
  "Item out of stock",
  "Too far / outside delivery area",
  "Restaurant too busy",
];

export function Showcase() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [underline, setUnderline] = useState("all");
  const [pill, setPill] = useState("new");
  const [segmented, setSegmented] = useState("board");
  const [available, setAvailable] = useState(true);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-brand-700">Development only</p>
        <h1 className="text-3xl font-bold">UI components</h1>
        <p className="mt-1 text-muted">
          Every component in src/components/ui, in all variants. Compare with
          /design/04 - Design System.png.
        </p>
      </header>

      <Section title="Colors">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
          {SWATCHES.map(([name, cls]) => (
            <div key={name}>
              <div className={`h-14 rounded-control border border-line ${cls}`} />
              <p className="mt-1 text-xs text-muted">{name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <p className="text-3xl font-bold">{formatPKR(6840000)}</p>
        <p className="text-2xl font-bold">Orders</p>
        <p className="text-lg font-bold">#1042 · Chicken Karahi (Full)</p>
        <p className="text-base">Gate pe call karein — body</p>
        <p className="text-sm text-muted">3 items · 4 min ago</p>
        <div className="rounded-card bg-brand-50 p-4">
          <UrduText className="block text-2xl">
            نیا آرڈر · آرڈر قبول کریں · ریسٹورنٹ کھلا ہے
          </UrduText>
          <p className="text-sm text-muted">
            New order · Accept order · Restaurant is open
          </p>
        </div>
        <Row label="formatPKR(paisa)">
          <code className="text-sm">185000 → {formatPKR(185000)}</code>
          <code className="text-sm">185050 → {formatPKR(185050)}</code>
          <code className="text-sm">0 → {formatPKR(0)}</code>
          <code className="text-sm">-5000 → {formatPKR(-5000)}</code>
        </Row>
      </Section>

      <Section title="Badges">
        <Row label="StatusBadge">
          {ORDER_STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </Row>
        <Row label="StatusBadge · md">
          {ORDER_STATUSES.map((s) => (
            <StatusBadge key={s} status={s} size="md" />
          ))}
        </Row>
        <Row label="SourceBadge">
          {ORDER_SOURCES.map((s) => (
            <SourceBadge key={s} source={s} />
          ))}
        </Row>
        <Row label="PaymentBadge">
          {PAYMENT_KINDS.map((p) => (
            <PaymentBadge key={p} payment={p} />
          ))}
        </Row>
        <Row label="OrderTypeBadge">
          {ORDER_TYPES.map((t) => (
            <OrderTypeBadge key={t} type={t} />
          ))}
          <OrderTypeBadge type="delivery">Gulberg III</OrderTypeBadge>
        </Row>
        <Row label="Badge · risk tag (square)">
          <Badge tone="danger-outline" shape="square" icon={<TriangleAlert />}>
            Fake order risk
          </Badge>
          <Badge tone="danger-outline" shape="square" size="md" icon={<TriangleAlert />}>
            Fake order risk · 2 refused before
          </Badge>
          <Badge tone="brand">Brand</Badge>
          <Badge tone="outline">Outline</Badge>
        </Row>
      </Section>

      <Section title="Buttons">
        <Row label="Variants · md (44px)">
          <Button icon={<Check />}>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="danger-outline">Danger outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row label="Large (56px)">
          <Button size="lg" icon={<Check />}>
            Accept order
          </Button>
          <Button size="lg" variant="danger-outline">
            Reject
          </Button>
        </Row>
        <Row label="Icon (always has aria-label)">
          <Button size="icon" variant="secondary" aria-label="Print">
            <Printer />
          </Button>
          <Button size="icon" variant="secondary" aria-label="Call customer">
            <Phone />
          </Button>
          <Button size="icon-lg" aria-label="Add">
            <Plus />
          </Button>
        </Row>
        <Row label="Loading">
          <Button loading>Saving</Button>
          <Button variant="secondary" loading>
            Loading
          </Button>
          <Button size="icon" variant="secondary" aria-label="Print" loading>
            <Printer />
          </Button>
          <Button
            icon={<Check />}
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1500);
            }}
          >
            Click to load
          </Button>
        </Row>
        <Row label="Full width">
          <Button fullWidth icon={<Bike />}>
            Assign rider
          </Button>
        </Row>
      </Section>

      <Section title="Cards">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Default</CardTitle>
              <StatusBadge status="preparing" />
            </CardHeader>
            <CardDescription>Border + shadow-sm, rounded-xl.</CardDescription>
          </Card>
          <Card tone="new">
            <CardHeader>
              <CardTitle>#1047</CardTitle>
              <span className="flex items-center gap-1 text-sm text-muted">
                <Clock aria-hidden className="size-4" /> 1 min ago
              </span>
            </CardHeader>
            <CardDescription>New order: amber border.</CardDescription>
          </Card>
          <Card tone="urgent">
            <CardHeader>
              <CardTitle>#1045</CardTitle>
              <span className="flex items-center gap-1 text-sm font-semibold text-brand-700">
                <Clock aria-hidden className="size-4" /> 6 min ago
              </span>
            </CardHeader>
            <p className="font-semibold">Fatima Noor</p>
            <p className="mt-1 text-sm text-muted">
              <span className="font-bold text-ink">3 items</span> · Chicken
              Tikka Pizza (L), Loaded Fries, Coke 1.5L
            </p>
            <p className="mt-2 flex items-center gap-1 text-sm text-muted">
              <MapPin aria-hidden className="size-4" /> Gulberg III
            </p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xl font-bold">{formatPKR(295000)}</span>
              <PaymentBadge payment="cod" />
            </div>
            <div className="mt-3 grid grid-cols-[1fr_1.6fr] gap-3">
              <Button variant="danger-outline">Reject</Button>
              <Button icon={<Check />}>Accept</Button>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Customer name" defaultValue="Ayesha Khan" />
          <Input
            label="Phone"
            defaultValue="0300-12345"
            inputMode="tel"
            error="Use format 0300-1234567"
          />
          <Input
            label="Search"
            placeholder="Search order # or phone"
            leadingIcon={<Search />}
          />
          <Input label="Disabled" defaultValue="Can't edit" disabled />
          <Select
            label="Area"
            defaultValue="dha5"
            options={[
              { value: "dha5", label: "DHA Phase 5" },
              { value: "gulberg", label: "Gulberg III" },
              { value: "johar", label: "Johar Town" },
            ]}
          />
          <Select
            label="Area (required)"
            placeholder="Choose area"
            defaultValue=""
            required
            hint="Delivery charges depend on area."
            options={[{ value: "bahria", label: "Bahria Town" }]}
          />
          <Textarea
            label="Note for kitchen"
            placeholder="e.g. Less spicy"
            hint="Customers' notes show on the kitchen slip."
            wrapperClassName="md:col-span-2"
          />
        </div>
      </Section>

      <Section title="Switch">
        <Row label="Brand (default) · md">
          <Switch
            checked={available}
            onCheckedChange={setAvailable}
            label="Zinger Burger"
            description={available ? "Available" : "Sold out"}
          />
          <Switch label="Mint Margarita" description="Sold out" />
          <Switch label="Disabled" disabled defaultChecked />
        </Row>
        <Row label="Success · lg">
          <Switch tone="success" size="lg" defaultChecked label="Auto-accept" />
          <Switch tone="success" size="lg" aria-label="Without label" />
        </Row>
      </Section>

      <Section title="Tabs">
        <Tabs
          aria-label="Order status filter"
          value={underline}
          onValueChange={setUnderline}
          items={[
            { value: "all", label: "All", count: 12 },
            { value: "new", label: "New", count: 3 },
            { value: "preparing", label: "Preparing", count: 3 },
          ]}
        />
        <Tabs
          aria-label="Order status"
          variant="pill"
          value={pill}
          onValueChange={setPill}
          items={[
            { value: "new", label: "New", count: 3 },
            { value: "preparing", label: "Preparing", count: 3 },
            { value: "ready", label: "Ready", count: 2 },
            { value: "out", label: "Out", count: 2 },
          ]}
        />
        <Tabs
          aria-label="View"
          variant="segmented"
          value={segmented}
          onValueChange={setSegmented}
          items={[
            { value: "board", label: "Board" },
            { value: "list", label: "List" },
          ]}
        />
      </Section>

      <Section title="Modal & Drawer">
        <Row label="Open">
          <Button variant="danger-outline" onClick={() => setModalOpen(true)}>
            Reject order (modal)
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Order details (drawer)
          </Button>
        </Row>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          tone="danger"
          icon={<TriangleAlert />}
          title="Reject order #1046?"
          description="Bilal Hussain will get a WhatsApp message with the reason."
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Keep order
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setModalOpen(false);
                  toast({ title: "Order #1046 rejected", tone: "info" });
                }}
              >
                Reject order
              </Button>
            </>
          }
        >
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Reason</legend>
            <div className="flex flex-col gap-2">
              {REJECT_REASONS.map((r) => (
                <label
                  key={r}
                  className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-line px-3 has-checked:border-brand-700 has-checked:bg-brand-50"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="size-4 accent-brand-700"
                  />
                  <span className="text-sm font-medium">{r}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Modal>
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="#1042"
          description="Ahmed Raza · 14 min ago"
          footer={
            <>
              <Button variant="secondary" icon={<Printer />}>
                Print
              </Button>
              <Button icon={<Check />}>Mark ready</Button>
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="preparing" />
            <OrderTypeBadge type="delivery">DHA Phase 5</OrderTypeBadge>
            <PaymentBadge payment="cod" />
            <SourceBadge source="whatsapp" />
          </div>
          <p className="mt-4 text-sm text-muted">
            Side panel for order details and edit forms. Full screen on phones.
          </p>
        </Drawer>
      </Section>

      <Section title="Toast">
        <Row label="Bottom-center on mobile, bottom-right on desktop · hides after 4s">
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "Order #1044 accepted · Kitchen slip printed",
                action: { label: "Undo", onClick: () => toast({ title: "Undone", tone: "info" }) },
              })
            }
          >
            Success + Undo
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "Printer not connected.",
                description: "Check the USB cable.",
                tone: "error",
              })
            }
          >
            Error
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast({ title: "Menu link copied", tone: "info" })}
          >
            Info
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({ title: "Stays until closed", tone: "info", duration: 0 })
            }
          >
            Persistent
          </Button>
        </Row>
      </Section>

      <Section title="Empty state">
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={<ClipboardList />}
            title="No orders yet today"
            description="When customers order on WhatsApp, their orders will show here — with a sound."
            actions={
              <>
                <Button>Share WhatsApp menu link</Button>
                <Button variant="secondary">Add phone order</Button>
              </>
            }
          />
          <EmptyState
            tone="delivery"
            icon={<Bike />}
            title="No riders added"
            description="Add your riders with their phone number. They get a simple page to see orders and cash to collect."
            actions={<Button icon={<Plus />}>Add rider</Button>}
          />
          <EmptyState
            icon={<BookOpen />}
            title="No items yet. Add your first item"
            actions={
              <div className="flex flex-col items-center gap-2">
                <Button icon={<Plus />}>Add item</Button>
                <span className="text-sm text-muted">or</span>
                <Button variant="secondary" icon={<Camera />}>
                  Upload a photo of your menu
                </Button>
              </div>
            }
          />
          <EmptyState
            tone="neutral"
            icon={<ClipboardList />}
            title="Neutral tone"
            description="No actions."
          />
        </div>
      </Section>

      <Section title="Skeleton">
        <Row label="Primitive">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="size-12 rounded-full" />
        </Row>
        <SkeletonList count={3} />
      </Section>

      <Section title="Offline banner">
        <p className="text-sm text-muted">
          Forced on here. In the app it appears only when the device goes
          offline (try DevTools → Network → Offline).
        </p>
        <OfflineBanner forceShow />
      </Section>
    </main>
  );
}
