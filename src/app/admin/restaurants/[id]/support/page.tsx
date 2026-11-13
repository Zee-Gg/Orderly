import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { SimplePage } from "@/components/shell/simple-page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSupportSnapshot } from "@/lib/admin/queries";
import { writeAuditLog } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth/session";
import { formatPKR } from "@/lib/money";
import { ORDER_TYPE_LABELS, SOURCE_LABELS, type OrderSource, type OrderStatus, type OrderType } from "@/lib/orders/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIMEZONE, formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Support view" };

/**
 * READ-ONLY look at a restaurant's dashboard data for helping them (Phase 12).
 * No buttons that change anything, no customer phones/addresses.
 * Every visit is written to that restaurant's audit_logs (who, when).
 */
async function Support({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSuperAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data: r } = await db.from("restaurants").select("id, name, slug, timezone, status").eq("id", id).maybeSingle();
  if (!r) notFound();
  await writeAuditLog(db, {
    restaurantId: r.id,
    userId: user.id,
    action: "support.viewed",
    entityType: "restaurant",
    entityId: r.id,
    newData: { by: user.email ?? user.id, at: new Date().toISOString() },
  });
  const tz = r.timezone || DEFAULT_TIMEZONE;
  const s = await getSupportSnapshot(r.id, tz);

  const tiles = [
    { label: "Done today", value: String(s.ordersToday) },
    { label: "Sales today", value: formatPKR(s.salesToday) },
    { label: "Orders in progress", value: String(s.openOrders) },
    { label: "Menu items", value: `${s.menuItems} in ${s.categories} categories` },
    { label: "Customers", value: String(s.customers) },
    { label: "Open chats", value: `${s.openChats}${s.needsStaff ? ` · ${s.needsStaff} need staff` : ""}` },
    { label: "Delivery areas", value: String(s.zones) },
    { label: "Last WhatsApp message", value: s.lastWebhookAt ? formatDateTime(s.lastWebhookAt, tz) : "—" },
  ];

  return (
    <SimplePage
      title={`${r.name} — support view`}
      subtitle="Read only · this visit is logged"
      actions={
        <Link href={`/admin/restaurants/${r.id}`} className="flex min-h-touch items-center gap-1 px-2 text-sm font-semibold text-brand-700">
          <ArrowLeft aria-hidden className="size-4" /> Back
        </Link>
      }
    >
      <p className="flex items-center gap-2 rounded-card border border-status-accepted-border bg-status-accepted-bg px-4 py-3 text-sm text-status-accepted-fg">
        <Eye aria-hidden className="size-5 shrink-0" /> You are looking, not editing. To change something, ask the owner or use the admin tools.
      </p>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <p className="text-sm text-muted">{t.label}</p>
            <p className="text-lg font-bold">{t.value}</p>
          </Card>
        ))}
      </section>
      <Card padding="lg">
        <CardHeader>
          <CardTitle>Last 20 orders</CardTitle>
        </CardHeader>
        {s.recentOrders.length === 0 ? (
          <p className="rounded-control border-2 border-dashed border-line px-4 py-6 text-center text-muted">No orders yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto lg:mx-0">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-subtle text-xs font-bold uppercase tracking-wide text-muted">
                  {["#", "When", "Branch", "Type", "From", "Total", "Status"].map((h) => (
                    <th key={h} className="px-3 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.recentOrders.map((o) => (
                  <tr key={o.orderNumber} className="border-t border-line">
                    <td className="px-3 py-2 font-bold">#{o.orderNumber}</td>
                    <td className="px-3 py-2">{formatDateTime(o.createdAt, tz)}</td>
                    <td className="px-3 py-2">{o.branch}</td>
                    <td className="px-3 py-2">{ORDER_TYPE_LABELS[o.orderType as OrderType] ?? o.orderType}</td>
                    <td className="px-3 py-2">{SOURCE_LABELS[o.source as OrderSource] ?? o.source}</td>
                    <td className="px-3 py-2">{formatPKR(o.total)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={o.status as OrderStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card padding="lg">
        <CardHeader>
          <CardTitle>Riders</CardTitle>
        </CardHeader>
        {s.riders.length === 0 ? (
          <p className="text-muted">No riders added.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {s.riders.map((rd) => (
              <li key={rd.name} className="rounded-full bg-subtle px-3 py-1">
                {rd.name} · {rd.isActive ? (rd.isOnline ? "online" : "offline") : "switched off"}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </SimplePage>
  );
}

export default function SupportPage({ params }: PageProps<"/admin/restaurants/[id]/support">) {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Support params={params} />
    </Suspense>
  );
}
