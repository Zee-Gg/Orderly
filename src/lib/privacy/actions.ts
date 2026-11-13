"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission, requireSuperAdmin } from "@/lib/auth/session";
import { formatPhone, normalizePhone } from "@/lib/orders/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { deleteCustomerData } from "./delete-customer";

/**
 * Customer data deletion (Phase 12): owner (customers.delete) for their own
 * restaurant, super admin for any. Find by phone first, then confirm.
 */
const findSchema = z.object({ phone: z.string().trim().min(4).max(30) });
const deleteSchema = z.object({ customerId: z.uuid(), confirm: z.literal("DELETE") });

export type FoundCustomer = { id: string; name: string | null; phone: string; totalOrders: number };

async function findCustomer(db: Awaited<ReturnType<typeof createClient>>, restaurantId: string, phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  if (!phone) return { error: "Enter a valid phone number, like 0300 1234567." } as const;
  const { data } = await db
    .from("customers")
    .select("id, name, phone, total_orders")
    .eq("restaurant_id", restaurantId)
    .eq("phone", phone)
    .maybeSingle();
  if (!data) return { error: `No customer with ${formatPhone(phone)}.` } as const;
  return { customer: { id: data.id, name: data.name, phone: formatPhone(data.phone), totalOrders: data.total_orders } } as const;
}

export async function findCustomerForDeletionAction(input: z.input<typeof findSchema>): Promise<ActionResult<FoundCustomer>> {
  try {
    const ctx = await requirePermission("customers.delete");
    const parsed = findSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const r = await findCustomer(await createClient(), ctx.restaurant.id, parsed.data.phone);
    if ("error" in r) return { ok: false, error: r.error ?? "Not found" };
    return { ok: true, data: r.customer };
  } catch (err) {
    return failure(err, "Couldn't search.");
  }
}

export async function deleteCustomerAction(input: z.input<typeof deleteSchema>): Promise<ActionResult<{ ordersAnonymized: number }>> {
  try {
    const ctx = await requirePermission("customers.delete");
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Type DELETE to confirm.' };
    // RLS check that this customer belongs to the owner's restaurant.
    const db = await createClient();
    const { data: customer } = await db
      .from("customers")
      .select("id")
      .eq("id", parsed.data.customerId)
      .eq("restaurant_id", ctx.restaurant.id)
      .maybeSingle();
    if (!customer) return { ok: false, error: "Customer not found." };
    const result = await deleteCustomerData(createAdminClient(), ctx.restaurant.id, customer.id);
    await writeAuditLog(db, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "customer.deleted",
      entityType: "customer",
      entityId: customer.id,
      newData: result,
    });
    revalidatePath("/customers");
    revalidatePath("/settings/data");
    return { ok: true, data: { ordersAnonymized: result.ordersAnonymized }, message: "Customer data deleted" };
  } catch (err) {
    return failure(err, "Couldn't delete this customer.");
  }
}

/** Super admin: same, for any restaurant (from /admin/restaurants/[id]). */
export async function adminDeleteCustomerAction(input: { restaurantId: string; phone: string; confirm: string }): Promise<ActionResult<{ ordersAnonymized: number }>> {
  try {
    const user = await requireSuperAdmin();
    const parsed = z.object({ restaurantId: z.uuid(), phone: z.string().trim().min(4).max(30), confirm: z.literal("DELETE") }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Enter the phone number and type DELETE to confirm." };
    const admin = createAdminClient();
    const r = await findCustomer(admin as unknown as Awaited<ReturnType<typeof createClient>>, parsed.data.restaurantId, parsed.data.phone);
    if ("error" in r) return { ok: false, error: r.error ?? "Not found" };
    const result = await deleteCustomerData(admin, parsed.data.restaurantId, r.customer.id);
    await writeAuditLog(admin, {
      restaurantId: parsed.data.restaurantId,
      userId: user.id,
      action: "customer.deleted",
      entityType: "customer",
      entityId: r.customer.id,
      newData: { ...result, by_super_admin: true },
    });
    return { ok: true, data: { ordersAnonymized: result.ordersAnonymized }, message: "Customer data deleted" };
  } catch (err) {
    return failure(err, "Couldn't delete this customer.");
  }
}
