import { describe, expect, it, vi } from "vitest";
import type { resolveCart } from "@/lib/menu/pricing";
import { computeOrderTotals } from "@/lib/menu/pricing";
import { createOrder, transitionOrder, type Actor, type EngineDeps } from "./engine";

const R = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const staff: Actor = { type: "staff", userId: "44444444-4444-4444-8444-444444444444", role: "staff" };
const manager: Actor = { ...staff, role: "manager" };

/** A fake pricing engine: every line costs Rs 550 × quantity. */
const fakeResolve = (async (_db: unknown, inputs: { itemId: string; quantity: number }[]) => {
  const results = inputs.map((i) => ({
    ok: true as const,
    line: {
      itemId: i.itemId,
      itemName: "Zinger Burger",
      itemNameUr: null,
      variantId: null,
      sizeName: null,
      basePrice: 55000,
      options: [],
      removals: [],
      quantity: i.quantity,
      unitPrice: 55000,
      lineTotal: 55000 * i.quantity,
      snapshot: {} as never,
    },
  }));
  return { ok: true, results, subtotal: results.reduce((s, r) => s + r.line.lineTotal, 0) };
}) as unknown as typeof resolveCart;

/** Minimal Supabase stand-in: records rpc calls, answers customer lookups. */
function fakeAdmin(options: { rpc?: (fn: string, args: unknown) => unknown; customer?: unknown; order?: unknown } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) c[m] = () => c;
    c.maybeSingle = async () => ({ data: result, error: null });
    c.insert = async () => ({ error: null });
    return c;
  };
  const admin = {
    from: (table: string) => chain(table === "customers" ? (options.customer ?? null) : (options.order ?? null)),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: options.rpc ? options.rpc(fn, args) : null, error: null };
    }),
  };
  return { admin: admin as unknown as EngineDeps["admin"], calls };
}

const baseInput = {
  branchId: B,
  idempotencyKey: "key-12345678",
  source: "phone" as const,
  orderType: "pickup" as const,
  paymentMethod: "cod" as const,
  customer: { phone: "0300-1234567", name: "Ayesha" },
  lines: [{ itemId: ITEM, quantity: 2 }],
};

describe("order totals", () => {
  it("adds delivery and subtracts discount", () => {
    const r = computeOrderTotals({ lines: [{ lineTotal: 110000 }, { lineTotal: 45000 }], deliveryFee: 15000, discount: 5000 });
    expect(r).toEqual({
      ok: true,
      totals: { subtotal: 155000, deliveryFee: 15000, discount: 5000, tax: 0, serviceCharge: 0, total: 165000 },
    });
  });

  it("caps the discount", () => {
    expect(computeOrderTotals({ lines: [{ lineTotal: 10000 }], discount: 6000, maxDiscountPercent: 50 })).toMatchObject({
      ok: false,
      error: { code: "DISCOUNT_TOO_HIGH" },
    });
    expect(computeOrderTotals({ lines: [{ lineTotal: 10000 }], discount: 5000, maxDiscountPercent: 50 }).ok).toBe(true);
  });

  it("rejects negative and fractional amounts", () => {
    expect(computeOrderTotals({ lines: [{ lineTotal: 100 }], deliveryFee: -1 }).ok).toBe(false);
    expect(computeOrderTotals({ lines: [{ lineTotal: 100.5 }] }).ok).toBe(false);
  });
});

describe("createOrder", () => {
  it("prices from the engine, normalises the phone and sends the idempotency key", async () => {
    const { admin, calls } = fakeAdmin({ rpc: () => ({ id: "o1", order_number: 1001, duplicate: false }) });
    const result = await createOrder({ admin, pricing: admin, resolve: fakeResolve }, { restaurantId: R, branchIds: [B] }, baseInput, staff);
    expect(result).toEqual({ ok: true, data: { id: "o1", orderNumber: 1001, duplicate: false } });
    const p = calls[0].args.p as Record<string, unknown>;
    expect(calls[0].fn).toBe("create_order");
    expect(p.idempotency_key).toBe("key-12345678");
    expect(p.customer).toEqual({ phone: "+923001234567", name: "Ayesha" });
    expect(p).toMatchObject({ subtotal: 110000, total: 110000, status: "accepted" });
  });

  it("returns the existing order for a repeated idempotency key", async () => {
    const { admin } = fakeAdmin({ rpc: () => ({ id: "o1", order_number: 1001, duplicate: true }) });
    const result = await createOrder({ admin, pricing: admin, resolve: fakeResolve }, { restaurantId: R, branchIds: [B] }, baseInput, staff);
    expect(result).toEqual({ ok: true, data: { id: "o1", orderNumber: 1001, duplicate: true } });
  });

  it("never sends a price from the input", async () => {
    const { admin, calls } = fakeAdmin({ rpc: () => ({ id: "o1", order_number: 1001, duplicate: false }) });
    const sneaky = { ...baseInput, lines: [{ itemId: ITEM, quantity: 1, unitPrice: 1, lineTotal: 1 }] } as unknown as typeof baseInput;
    await createOrder({ admin, pricing: admin, resolve: fakeResolve }, { restaurantId: R, branchIds: [B] }, sneaky, staff);
    const items = (calls[0].args.p as { items: { unit_price: number }[] }).items;
    expect(items[0].unit_price).toBe(55000);
  });

  it("rejects branches outside the user's access", async () => {
    const { admin, calls } = fakeAdmin();
    const result = await createOrder({ admin, pricing: admin, resolve: fakeResolve }, { restaurantId: R, branchIds: [] }, baseInput, staff);
    expect(result).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(calls).toHaveLength(0);
  });

  it("rejects bad phone numbers", async () => {
    const { admin } = fakeAdmin();
    const result = await createOrder(
      { admin, pricing: admin, resolve: fakeResolve },
      { restaurantId: R, branchIds: [B] },
      { ...baseInput, customer: { phone: "0300-12", name: "" } },
      staff,
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PHONE" });
  });

  it("blocks discounts for staff and allows them for managers", async () => {
    const withDiscount = { ...baseInput, discount: 5000 };
    const a = fakeAdmin({ rpc: () => ({ id: "o1", order_number: 1001, duplicate: false }) });
    expect(await createOrder({ admin: a.admin, pricing: a.admin, resolve: fakeResolve }, { restaurantId: R, branchIds: [B] }, withDiscount, staff)).toMatchObject({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(
      (await createOrder({ admin: a.admin, pricing: a.admin, resolve: fakeResolve }, { restaurantId: R, branchIds: [B] }, withDiscount, manager)).ok,
    ).toBe(true);
  });

  it("stops blocked customers unless a manager overrides with a reason", async () => {
    const blocked = { id: "c1", is_blocked: true, blocked_reason: "Fake orders" };
    const a = fakeAdmin({ customer: blocked, rpc: () => ({ id: "o1", order_number: 1001, duplicate: false }) });
    const deps = { admin: a.admin, pricing: a.admin, resolve: fakeResolve };
    const scope = { restaurantId: R, branchIds: [B] };
    expect(await createOrder(deps, scope, baseInput, manager)).toMatchObject({ ok: false, code: "CUSTOMER_BLOCKED" });
    expect(await createOrder(deps, scope, { ...baseInput, overrideBlockReason: "Paid in advance" }, staff)).toMatchObject({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect((await createOrder(deps, scope, { ...baseInput, overrideBlockReason: "Paid in advance" }, manager)).ok).toBe(true);
  });

  it("requires an address for delivery", async () => {
    const { admin } = fakeAdmin();
    const result = await createOrder(
      { admin, pricing: admin, resolve: fakeResolve },
      { restaurantId: R, branchIds: [B] },
      { ...baseInput, orderType: "delivery" },
      staff,
    );
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("transitionOrder", () => {
  const order = {
    id: "55555555-5555-4555-8555-555555555555",
    restaurant_id: R,
    branch_id: B,
    order_number: 1001,
    status: "preparing",
    order_type: "delivery",
    is_on_hold: false,
    version: 3,
    total: 100,
    payment_status: "unpaid",
  };

  it("refuses a stale version before touching the database", async () => {
    const { admin, calls } = fakeAdmin({ order });
    const result = await transitionOrder(
      { admin, pricing: admin },
      { restaurantId: R, branchIds: [B] },
      { orderId: order.id, expectedVersion: 2, path: ["ready"] },
      staff,
    );
    expect(result).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
    expect(calls).toHaveLength(0);
  });

  it("requires a valid cancel reason, and a note for 'other'", async () => {
    const { admin } = fakeAdmin({ order });
    const deps = { admin, pricing: admin };
    const scope = { restaurantId: R, branchIds: [B] };
    expect(await transitionOrder(deps, scope, { orderId: order.id, expectedVersion: 3, path: ["cancelled"] }, manager)).toMatchObject({
      ok: false,
      code: "REASON_REQUIRED",
    });
    expect(
      await transitionOrder(deps, scope, { orderId: order.id, expectedVersion: 3, path: ["cancelled"], reason: "other" }, manager),
    ).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
  });

  it("staff can't cancel an order that is being prepared", async () => {
    const { admin } = fakeAdmin({ order });
    const result = await transitionOrder(
      { admin, pricing: admin },
      { restaurantId: R, branchIds: [B] },
      { orderId: order.id, expectedVersion: 3, path: ["cancelled"], reason: "fake_order" },
      staff,
    );
    expect(result).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
  });
});
