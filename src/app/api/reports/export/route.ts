import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { PermissionError, requirePermission } from "@/lib/auth/session";
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, type OrderType, type PaymentMethod } from "@/lib/orders/constants";
import { CHANNEL_LABELS, STATUS_WORDS } from "@/lib/reports/labels";
import { rupees, toCsv, type CsvCell } from "@/lib/reports/csv";
import { exportArgs, getRiders, getTopItems } from "@/lib/reports/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/reports/export?type=orders|items|riders&range=…&from=…&to=…&branch=…
 * CSV downloads for owners/managers (Phase 11). Same RPCs as /reports (user
 * client, RLS applies). Phones are masked in the database. Every export is
 * written to audit_logs.
 */
const querySchema = z.object({
  type: z.enum(["orders", "items", "riders"]),
  range: z.string().max(20).nullish(),
  from: z.string().max(10).nullish(),
  to: z.string().max(10).nullish(),
  branch: z.string().max(40).nullish(),
});

function dateTime(iso: string, timeZone: string) {
  // "2026-11-13 19:45" in the restaurant's time zone (sortable in Excel).
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

export async function GET(req: Request) {
  let ctx;
  try {
    ctx = await requirePermission("reports.view");
  } catch (err) {
    if (err instanceof PermissionError) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const q = parsed.data;

  const { range, branch, timezone, args } = await exportArgs(ctx, q);
  const db = await createClient();

  let csv: string;
  let rowCount: number;
  try {
    if (q.type === "orders") {
      const { data, error } = await db.rpc("report_orders_export", args);
      if (error) throw error;
      const rows = data ?? [];
      rowCount = rows.length;
      csv = toCsv(
        ["Order #", "Date", "Branch", "Customer", "Phone", "Type", "Came from", "Items", "Subtotal (Rs)", "Delivery fee (Rs)", "Discount (Rs)", "Total (Rs)", "Payment method", "Payment", "Status"],
        rows.map((r): CsvCell[] => [
          r.order_number,
          dateTime(r.created_at, timezone),
          r.branch_name,
          r.customer_name,
          r.phone_masked,
          ORDER_TYPE_LABELS[r.order_type as OrderType] ?? r.order_type,
          CHANNEL_LABELS[r.channel] ?? r.channel,
          r.items,
          rupees(r.subtotal),
          rupees(r.delivery_fee),
          rupees(r.discount),
          rupees(r.total),
          PAYMENT_METHOD_LABELS[r.payment_method as PaymentMethod] ?? r.payment_method,
          r.payment_status,
          STATUS_WORDS[r.status] ?? r.status,
        ]),
      );
    } else if (q.type === "items") {
      const { top } = await getTopItems(db, args, 500);
      rowCount = top.length;
      csv = toCsv(
        ["Rank", "Item", "Quantity sold", "Sales (Rs)"],
        top.map((r, i): CsvCell[] => [i + 1, r.name, r.qty, rupees(r.revenue)]),
      );
    } else {
      const riders = await getRiders(db, args);
      rowCount = riders.length;
      csv = toCsv(
        ["Rider", "Deliveries", "Average delivery time (min)", "Failed deliveries", "Cash collected (Rs)"],
        riders.map((r): CsvCell[] => [r.name, r.deliveries, r.avgMinutes, r.failed, rupees(r.cashCollected)]),
      );
    }
  } catch (err) {
    console.error("[reports] export failed", err);
    return NextResponse.json({ error: "Couldn't build the file. Try again." }, { status: 500 });
  }

  await writeAuditLog(db, {
    restaurantId: ctx.restaurant.id,
    userId: ctx.user.id,
    action: "report.exported",
    entityType: "report",
    entityId: q.type,
    newData: { type: q.type, from: range.from, to: range.to, branch_id: branch.id, rows: rowCount },
  });

  const slug = branch.id ? branch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "branch" : "all-branches";
  const name = `${q.type}-${slug}-${range.from}${range.to !== range.from ? `-to-${range.to}` : ""}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
