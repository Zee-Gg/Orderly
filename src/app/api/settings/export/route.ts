import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { PermissionError, requirePermission } from "@/lib/auth/session";
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, type OrderType, type PaymentMethod } from "@/lib/orders/constants";
import { formatPhone } from "@/lib/orders/phone";
import { rupees, toCsv, type CsvCell } from "@/lib/reports/csv";
import { STATUS_WORDS } from "@/lib/reports/labels";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";

/**
 * GET /api/settings/export?type=orders|customers|menu — the owner downloads
 * their own restaurant's data (Phase 12, /settings/data). User client: RLS.
 * Full phone numbers here (it's the owner's own customer list). Audited.
 */
const querySchema = z.object({ type: z.enum(["orders", "customers", "menu"]) });
const PAGE = 1000;
const MAX_ROWS = 100_000;

function stamp(iso: string | null, timeZone: string) {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

/** Read every row in pages of 1000 (PostgREST limit). */
async function all<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function GET(req: Request) {
  let ctx;
  try {
    ctx = await requirePermission("data.export");
  } catch (err) {
    if (err instanceof PermissionError) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    throw err;
  }
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { type } = parsed.data;
  const db = await createClient();
  const rid = ctx.restaurant.id;
  const tz = ctx.restaurant.timezone || DEFAULT_TIMEZONE;

  let csv: string;
  let rows = 0;
  try {
    if (type === "orders") {
      const [orders, branches] = await Promise.all([
        all((f, t) =>
          db
            .from("orders")
            .select("id, order_number, created_at, branch_id, customer_name, customer_phone, order_type, source, status, payment_method, payment_status, subtotal, delivery_fee, discount, tax, service_charge, total, address_text, area, cancel_reason")
            .eq("restaurant_id", rid)
            .neq("status", "pending_confirmation")
            .order("created_at")
            .range(f, t),
        ),
        db.from("branches").select("id, name").eq("restaurant_id", rid),
      ]);
      const names = new Map((branches.data ?? []).map((b) => [b.id, b.name]));
      rows = orders.length;
      csv = toCsv(
        ["Order #", "Date", "Branch", "Customer", "Phone", "Type", "Source", "Status", "Payment method", "Payment", "Subtotal (Rs)", "Delivery fee (Rs)", "Discount (Rs)", "Tax (Rs)", "Service charge (Rs)", "Total (Rs)", "Address", "Area", "Cancel reason"],
        orders.map((o): CsvCell[] => [
          o.order_number,
          stamp(o.created_at, tz),
          names.get(o.branch_id) ?? "",
          o.customer_name,
          formatPhone(o.customer_phone) || o.customer_phone,
          ORDER_TYPE_LABELS[o.order_type as OrderType] ?? o.order_type,
          o.source,
          STATUS_WORDS[o.status] ?? o.status,
          PAYMENT_METHOD_LABELS[o.payment_method as PaymentMethod] ?? o.payment_method,
          o.payment_status,
          rupees(o.subtotal),
          rupees(o.delivery_fee),
          rupees(o.discount),
          rupees(o.tax),
          rupees(o.service_charge),
          rupees(o.total),
          o.address_text,
          o.area,
          o.cancel_reason,
        ]),
      );
    } else if (type === "customers") {
      const customers = await all((f, t) =>
        db
          .from("customers")
          .select("name, phone, total_orders, total_spent, cancelled_count, last_order_at, tags, notes, is_blocked, created_at")
          .eq("restaurant_id", rid)
          .order("created_at")
          .range(f, t),
      );
      rows = customers.length;
      csv = toCsv(
        ["Name", "Phone", "Orders", "Total spent (Rs)", "Cancelled", "Last order", "Tags", "Notes", "Blocked", "First seen"],
        customers.map((c): CsvCell[] => [
          c.name,
          formatPhone(c.phone) || c.phone,
          c.total_orders,
          rupees(c.total_spent),
          c.cancelled_count,
          stamp(c.last_order_at, tz),
          c.tags.join(", "),
          c.notes,
          c.is_blocked ? "Yes" : "No",
          stamp(c.created_at, tz),
        ]),
      );
    } else {
      const [cats, items, sizes] = await Promise.all([
        db.from("menu_categories").select("id, name").eq("restaurant_id", rid),
        all((f, t) =>
          db.from("menu_items").select("id, category_id, name, name_ur, description, base_price, is_active, tags, archived_at, sort_order").eq("restaurant_id", rid).order("sort_order").range(f, t),
        ),
        all((f, t) => db.from("item_variants").select("item_id, name, price, archived_at").eq("restaurant_id", rid).range(f, t)),
      ]);
      const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
      const sizesOf = new Map<string, string[]>();
      for (const s of sizes) {
        if (s.archived_at) continue;
        sizesOf.set(s.item_id, [...(sizesOf.get(s.item_id) ?? []), `${s.name}: Rs ${rupees(s.price)}`]);
      }
      const live = items.filter((i) => !i.archived_at);
      rows = live.length;
      csv = toCsv(
        ["Category", "Item", "Urdu name", "Description", "Price (Rs)", "Sizes", "Tags", "Showing on menu"],
        live.map((i): CsvCell[] => [
          catName.get(i.category_id) ?? "",
          i.name,
          i.name_ur,
          i.description,
          i.base_price === null ? "" : rupees(i.base_price),
          (sizesOf.get(i.id) ?? []).join("; "),
          i.tags.join(", "),
          i.is_active ? "Yes" : "No",
        ]),
      );
    }
  } catch (err) {
    console.error("[data-export] failed", err);
    return NextResponse.json({ error: "Couldn't build the file. Try again." }, { status: 500 });
  }

  await writeAuditLog(db, {
    restaurantId: rid,
    userId: ctx.user.id,
    action: "data.exported",
    entityType: "restaurant",
    entityId: rid,
    newData: { type, rows },
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ctx.restaurant.slug}-${type}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
