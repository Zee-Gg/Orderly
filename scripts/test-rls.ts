/**
 * RLS isolation test. Run with:  npx tsx scripts/test-rls.ts   (or npm run test:rls)
 *
 * Creates 2 owners with 2 restaurants + a kitchen user in restaurant A,
 * signs in as each with the normal (publishable key) client, and proves that
 * tenants are isolated and nobody can escalate their own privileges.
 * All test data is deleted at the end, even if a check fails.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { createOrder, transitionOrder, type Actor } from "../src/lib/orders/engine";
import { encryptToken } from "../src/lib/whatsapp/crypto";
import { MockLanguageModelV4 } from "ai/test";
import { runBotTurn } from "../src/lib/bot/agent";
import { buildMenuIndex } from "../src/lib/bot/menu-index";
import { createSupabaseBotStore } from "../src/lib/bot/store";
import { createBotTestRestaurant } from "../src/lib/bot/testing/test-restaurant";
import { getBranchMenu } from "../src/lib/menu/pricing";
import { createCartDraft } from "../src/lib/menu-page/drafts";

process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !publishableKey || !secretKey) {
  throw new Error("Missing Supabase env vars in .env.local");
}

type Client = SupabaseClient<Database>;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: Client = createClient<Database>(url, secretKey, noSession);

const RUN = Date.now().toString(36);
const PASSWORD = `Rls-test-${RUN}-Aa1!`;
const LOGO_BUCKET = "restaurant-logos";
const MEDIA_BUCKET = "whatsapp-media";
const BOT_MEDIA_BUCKET = "bot-media";

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  const tag = pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${tag}  ${name}${!pass && detail ? `  → ${detail}` : ""}`);
}
function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------
type TestUser = { id: string; email: string; client: Client };
const createdUserIds: string[] = [];
const createdRestaurantIds: string[] = [];
const uploadedPaths: string[] = [];
const uploadedMediaPaths: string[] = [];
const uploadedBotMediaPaths: string[] = [];

async function makeUser(label: string): Promise<TestUser> {
  const email = `rls-${label}-${RUN}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `RLS ${label}` },
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);

  const client = createClient<Database>(url!, publishableKey!, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw new Error(`signIn ${label}: ${signInError.message}`);
  return { id: data.user.id, email, client };
}

const HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
    d,
    { closed: false, open: "12:00", close: "02:00" },
  ]),
);

async function makeRestaurant(owner: TestUser, label: string) {
  const { data, error } = await owner.client.rpc("create_restaurant_with_owner", {
    p_name: `RLS Test ${label}`,
    p_slug: `rls-${label}-${RUN}`,
    p_city: "Lahore",
    p_phone: "03001234567",
    p_branch_name: `${label} Main`,
    p_branch_address: "1 Test Road",
    p_branch_area: "Gulberg",
    p_opening_hours: HOURS,
  });
  if (error || !data) throw new Error(`create restaurant ${label}: ${error?.message}`);
  createdRestaurantIds.push(data);
  const { data: branch } = await admin
    .from("branches")
    .select("id")
    .eq("restaurant_id", data)
    .single();
  return { id: data, branchId: branch!.id, slug: `rls-${label}-${RUN}` };
}

const fakePng = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
  type: "image/png",
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
async function crossTenantChecks(
  me: TestUser,
  myLabel: string,
  mine: { id: string },
  other: { id: string; branchId: string },
  otherLabel: string,
) {
  section(`Owner ${myLabel} vs restaurant ${otherLabel}`);
  const c = me.client;

  const r1 = await c.from("restaurants").select("id").eq("id", other.id);
  check(`${myLabel} cannot read restaurant ${otherLabel}`, !r1.error && r1.data.length === 0, JSON.stringify(r1));

  const r2 = await c.from("restaurants").select("id");
  check(
    `${myLabel} sees only their own restaurant in a full list`,
    !r2.error && r2.data.length === 1 && r2.data[0].id === mine.id,
    JSON.stringify(r2.data),
  );

  const r3 = await c.from("branches").select("id").eq("restaurant_id", other.id);
  check(`${myLabel} cannot read ${otherLabel}'s branches`, !r3.error && r3.data.length === 0, JSON.stringify(r3));

  const r4 = await c.from("memberships").select("id").eq("restaurant_id", other.id);
  check(`${myLabel} cannot read ${otherLabel}'s memberships`, !r4.error && r4.data.length === 0, JSON.stringify(r4));

  const r5 = await c.from("audit_logs").select("id").eq("restaurant_id", other.id);
  check(`${myLabel} cannot read ${otherLabel}'s audit logs`, !r5.error && r5.data.length === 0, JSON.stringify(r5));

  const u1 = await c.from("restaurants").update({ name: "HACKED" }).eq("id", other.id).select("id");
  const after = await admin.from("restaurants").select("name").eq("id", other.id).single();
  check(
    `${myLabel} cannot update restaurant ${otherLabel}`,
    (u1.error !== null || u1.data.length === 0) && after.data?.name !== "HACKED",
    JSON.stringify(u1),
  );

  const u2 = await c.from("branches").update({ is_open: true, name: "HACKED" }).eq("id", other.branchId).select("id");
  const branchAfter = await admin.from("branches").select("name").eq("id", other.branchId).single();
  check(
    `${myLabel} cannot update ${otherLabel}'s branch`,
    (u2.error !== null || u2.data.length === 0) && branchAfter.data?.name !== "HACKED",
    JSON.stringify(u2),
  );

  const i1 = await c.from("branches").insert({ restaurant_id: other.id, name: "Sneaky branch" });
  check(`${myLabel} cannot add a branch to ${otherLabel}`, i1.error !== null, JSON.stringify(i1));

  const i2 = await c
    .from("memberships")
    .insert({ user_id: me.id, restaurant_id: other.id, role: "manager" });
  check(`${myLabel} cannot join ${otherLabel} as a member`, i2.error !== null, JSON.stringify(i2));

  const i3 = await c.from("audit_logs").insert({
    restaurant_id: other.id,
    user_id: me.id,
    action: "test.injected",
    entity_type: "test",
  });
  check(`${myLabel} cannot write ${otherLabel}'s audit log`, i3.error !== null, JSON.stringify(i3));

  const s1 = await c.storage.from(LOGO_BUCKET).upload(`${other.id}/evil-${RUN}.png`, fakePng);
  if (!s1.error) uploadedPaths.push(`${other.id}/evil-${RUN}.png`);
  check(`${myLabel} cannot upload a logo into ${otherLabel}'s folder`, s1.error !== null, JSON.stringify(s1.data));
}

async function main() {
  console.log(`RLS isolation test · run ${RUN}`);

  section("Setup");
  const ownerA = await makeUser("owner-a");
  const ownerB = await makeUser("owner-b");
  const kitchenA = await makeUser("kitchen-a");
  const restA = await makeRestaurant(ownerA, "a");
  const restB = await makeRestaurant(ownerB, "b");
  check("Owners can create a restaurant through the RPC", true);

  const addKitchen = await ownerA.client
    .from("memberships")
    .insert({ user_id: kitchenA.id, restaurant_id: restA.id, role: "kitchen" });
  check("Owner A can add a kitchen member to restaurant A", addKitchen.error === null, JSON.stringify(addKitchen.error));

  // --- Positive checks: legitimate access still works ----------------------
  section("Legitimate access works");
  const ownRest = await ownerA.client.from("restaurants").update({ city: "Karachi" }).eq("id", restA.id).select("id");
  check("Owner A can update their own restaurant", !ownRest.error && ownRest.data.length === 1, JSON.stringify(ownRest));

  const toStaff = await ownerA.client
    .from("memberships")
    .update({ role: "staff" })
    .eq("user_id", kitchenA.id)
    .eq("restaurant_id", restA.id)
    .select("id");
  check("Owner A can change a member's role", !toStaff.error && toStaff.data.length === 1, JSON.stringify(toStaff));
  await ownerA.client
    .from("memberships")
    .update({ role: "kitchen" })
    .eq("user_id", kitchenA.id)
    .eq("restaurant_id", restA.id);

  const logoPath = `${restA.id}/logo-${RUN}.png`;
  const ownLogo = await ownerA.client.storage.from(LOGO_BUCKET).upload(logoPath, fakePng);
  if (!ownLogo.error) uploadedPaths.push(logoPath);
  check("Owner A can upload a logo to their own folder", ownLogo.error === null, JSON.stringify(ownLogo.error));

  const sameRestProfile = await ownerA.client.from("profiles").select("id").eq("id", kitchenA.id);
  check(
    "Owner A can read their kitchen user's profile",
    !sameRestProfile.error && sameRestProfile.data.length === 1,
    JSON.stringify(sameRestProfile),
  );

  const kitchenSeesBranch = await kitchenA.client.from("branches").select("id").eq("id", restA.branchId);
  check(
    "Kitchen user can read their restaurant's branch",
    !kitchenSeesBranch.error && kitchenSeesBranch.data.length === 1,
    JSON.stringify(kitchenSeesBranch),
  );

  const kitchenAudit = await kitchenA.client.from("audit_logs").insert({
    restaurant_id: restA.id,
    user_id: kitchenA.id,
    action: "test.kitchen_entry",
    entity_type: "test",
  });
  check("Kitchen user can add an audit entry (insert-only)", kitchenAudit.error === null, JSON.stringify(kitchenAudit.error));

  // --- Tenant isolation ------------------------------------------------------
  await crossTenantChecks(ownerA, "A", restA, restB, "B");
  await crossTenantChecks(ownerB, "B", restB, restA, "A");

  const crossProfile = await ownerA.client.from("profiles").select("id").eq("id", ownerB.id);
  check("Owner A cannot read owner B's profile", !crossProfile.error && crossProfile.data.length === 0, JSON.stringify(crossProfile));

  // --- Kitchen user limits ---------------------------------------------------
  section("Kitchen user cannot change roles or settings");
  const k = kitchenA.client;

  const kRoleSelf = await k.from("memberships").update({ role: "manager" }).eq("user_id", kitchenA.id).select("id");
  const kRoleOwner = await k.from("memberships").update({ role: "staff" }).eq("user_id", ownerA.id).select("id");
  const roles = await admin.from("memberships").select("user_id, role").eq("restaurant_id", restA.id);
  const roleOf = (id: string) => roles.data?.find((m) => m.user_id === id)?.role;
  check(
    "Kitchen cannot promote themselves to manager",
    (kRoleSelf.error !== null || kRoleSelf.data.length === 0) && roleOf(kitchenA.id) === "kitchen",
    JSON.stringify(kRoleSelf),
  );
  check(
    "Kitchen cannot change the owner's role",
    (kRoleOwner.error !== null || kRoleOwner.data.length === 0) && roleOf(ownerA.id) === "owner",
    JSON.stringify(kRoleOwner),
  );

  const kRest = await k.from("restaurants").update({ name: "Kitchen Rules" }).eq("id", restA.id).select("id");
  check("Kitchen cannot edit restaurant settings", kRest.error !== null || kRest.data.length === 0, JSON.stringify(kRest));

  const kBranch = await k.from("branches").update({ is_open: true }).eq("id", restA.branchId).select("id");
  check("Kitchen cannot edit branch settings", kBranch.error !== null || kBranch.data.length === 0, JSON.stringify(kBranch));

  const kNewBranch = await k.from("branches").insert({ restaurant_id: restA.id, name: "Kitchen branch" });
  check("Kitchen cannot create branches", kNewBranch.error !== null, JSON.stringify(kNewBranch));

  const kAddMember = await k
    .from("memberships")
    .insert({ user_id: ownerB.id, restaurant_id: restA.id, role: "staff" });
  check("Kitchen cannot add staff", kAddMember.error !== null, JSON.stringify(kAddMember));

  const kMembers = await k.from("memberships").select("user_id").eq("restaurant_id", restA.id);
  check(
    "Kitchen sees only their own membership",
    !kMembers.error && kMembers.data.length === 1 && kMembers.data[0].user_id === kitchenA.id,
    JSON.stringify(kMembers.data),
  );

  const kAuditRead = await k.from("audit_logs").select("id").eq("restaurant_id", restA.id);
  check("Kitchen cannot read the audit log", !kAuditRead.error && kAuditRead.data.length === 0, JSON.stringify(kAuditRead));

  const kLogo = await k.storage.from(LOGO_BUCKET).upload(`${restA.id}/kitchen-${RUN}.png`, fakePng);
  if (!kLogo.error) uploadedPaths.push(`${restA.id}/kitchen-${RUN}.png`);
  check("Kitchen cannot upload the restaurant logo", kLogo.error !== null, JSON.stringify(kLogo.data));

  // --- Privilege escalation ----------------------------------------------------
  section("Nobody can escalate their own privileges");
  for (const [label, user] of [
    ["Owner A", ownerA],
    ["Owner B", ownerB],
    ["Kitchen", kitchenA],
  ] as const) {
    const sa = await user.client.from("profiles").update({ is_super_admin: true } as never).eq("id", user.id);
    const mcp = await user.client.from("profiles").update({ must_change_password: false } as never).eq("id", user.id);
    const prof = await admin.from("profiles").select("is_super_admin").eq("id", user.id).single();
    check(`${label} cannot set is_super_admin on themselves`, sa.error !== null && prof.data?.is_super_admin === false, JSON.stringify(sa));
    check(`${label} cannot clear must_change_password themselves`, mcp.error !== null, JSON.stringify(mcp));
  }

  const kToOwner = await k.from("memberships").update({ role: "owner" }).eq("user_id", kitchenA.id).select("id");
  check("Kitchen cannot make themselves owner", kToOwner.error !== null || kToOwner.data.length === 0, JSON.stringify(kToOwner));

  const ownerMakesOwner = await ownerA.client
    .from("memberships")
    .insert({ user_id: ownerB.id, restaurant_id: restA.id, role: "owner" });
  check("Owner cannot create a second owner", ownerMakesOwner.error !== null, JSON.stringify(ownerMakesOwner));

  const ownerPromotesKitchen = await ownerA.client
    .from("memberships")
    .update({ role: "owner" })
    .eq("user_id", kitchenA.id)
    .eq("restaurant_id", restA.id)
    .select("id");
  check(
    "Owner cannot promote someone to owner",
    ownerPromotesKitchen.error !== null || ownerPromotesKitchen.data.length === 0,
    JSON.stringify(ownerPromotesKitchen),
  );

  const ownerSelfEdit = await ownerA.client
    .from("memberships")
    .update({ is_active: false })
    .eq("user_id", ownerA.id)
    .select("id");
  check(
    "Owner cannot deactivate or demote themselves",
    ownerSelfEdit.error !== null || ownerSelfEdit.data.length === 0,
    JSON.stringify(ownerSelfEdit),
  );

  const directInsert = await ownerA.client
    .from("restaurants")
    .insert({ name: "Direct", slug: `direct-${RUN}` } as never);
  check("Restaurants can't be created except through the RPC", directInsert.error !== null, JSON.stringify(directInsert));

  const deleteRest = await ownerA.client.from("restaurants").delete().eq("id", restA.id).select("id");
  check("Owner cannot delete a restaurant via the API", deleteRest.error !== null || deleteRest.data.length === 0, JSON.stringify(deleteRest));

  const auditDelete = await ownerA.client.from("audit_logs").delete().eq("restaurant_id", restA.id).select("id");
  const auditUpdate = await ownerA.client
    .from("audit_logs")
    .update({ action: "tampered" } as never)
    .eq("restaurant_id", restA.id)
    .select("id");
  check("Audit log entries cannot be deleted", auditDelete.error !== null || auditDelete.data.length === 0, JSON.stringify(auditDelete));
  check("Audit log entries cannot be edited", auditUpdate.error !== null || auditUpdate.data.length === 0, JSON.stringify(auditUpdate));

  const dupSlug = await ownerA.client.rpc("create_restaurant_with_owner", {
    p_name: "Duplicate",
    p_slug: `rls-b-${RUN}`,
    p_city: "",
    p_phone: "",
    p_branch_name: "Main",
    p_branch_address: "",
    p_branch_area: "",
    p_opening_hours: HOURS,
  });
  check("RPC rejects a slug that is already taken", dupSlug.error !== null, JSON.stringify(dupSlug));

  // --- Signed-out visitors -------------------------------------------------------
  section("Signed-out visitors");
  const anon = createClient<Database>(url!, publishableKey!, noSession);
  const anonRest = await anon.from("restaurants").select("id");
  check("Anonymous users cannot read restaurants", anonRest.error !== null || anonRest.data.length === 0, JSON.stringify(anonRest));
  const anonRpc = await anon.rpc("create_restaurant_with_owner", {
    p_name: "Anon",
    p_slug: `anon-${RUN}`,
    p_city: "",
    p_phone: "",
    p_branch_name: "Main",
    p_branch_address: "",
    p_branch_area: "",
    p_opening_hours: HOURS,
  });
  check("Anonymous users cannot create restaurants", anonRpc.error !== null, JSON.stringify(anonRpc));

  await orderChecks(ownerA, ownerB, kitchenA, restA, restB);
  await menuChecks(ownerA, ownerB, kitchenA, restA, restB);
  await whatsappChecks(ownerA, ownerB, kitchenA, restA);
  await botChecks(ownerA, ownerB, kitchenA, restA);
  await knowledgeChecks(ownerA, ownerB, kitchenA, restA);
  await menuPageSecurityChecks(ownerA, ownerB, kitchenA, restA);
  await botConversationCheck();
  await menuPageFlowCheck();
}

async function orderChecks(ownerA: TestUser, ownerB: TestUser, kitchenA: TestUser, restA: Rest, restB: Rest) {
  section("Orders: setup with the real order engine");
  // A second branch in A, and a staff member limited to it.
  const { data: branch2 } = await admin
    .from("branches")
    .insert({ restaurant_id: restA.id, name: "A Second" })
    .select("id")
    .single();
  const staff2 = await makeUser("staff-a2");
  await ownerA.client
    .from("memberships")
    .insert({ user_id: staff2.id, restaurant_id: restA.id, role: "staff", branch_id: branch2!.id });

  const { data: cat } = await admin.from("menu_categories").insert({ restaurant_id: restA.id, name: "Orders test" }).select("id").single();
  const { data: dish } = await admin
    .from("menu_items")
    .insert({ restaurant_id: restA.id, category_id: cat!.id, name: "Biryani", base_price: 45000 })
    .select("id")
    .single();

  const deps = { admin, pricing: ownerA.client };
  const ownerActor: Actor = { type: "staff", userId: ownerA.id, role: "owner" };
  const scopeA = { restaurantId: restA.id, branchIds: [restA.branchId, branch2!.id] };
  const order = (branchId: string, key: string, extra: Record<string, unknown> = {}) => ({
    branchId,
    idempotencyKey: `${key}-${RUN}`,
    source: "phone" as const,
    orderType: "delivery" as const,
    paymentMethod: "cod" as const,
    customer: { phone: "0300-7654321", name: "Test Customer" },
    address: { addressText: "House 1, Street 2", area: "Gulberg", landmark: "Near mosque", save: true },
    deliveryFee: 15000,
    lines: [{ itemId: dish!.id, quantity: 2 }],
    ...extra,
  });

  const created = await createOrder(deps, scopeA, order(restA.branchId, "o1"), ownerActor);
  check("Owner A creates an order through the engine", created.ok, JSON.stringify(created));
  const orderId = created.ok ? created.data.id : "";
  const { data: saved } = await admin.from("orders").select("subtotal, total, customer_phone").eq("id", orderId).single();
  check(
    "Totals come from the pricing engine (2 × Rs 450 + Rs 150 delivery)",
    saved?.subtotal === 90000 && saved?.total === 105000 && saved?.customer_phone === "+923007654321",
    JSON.stringify(saved),
  );

  // Idempotency: two simultaneous submits with the same key → one order.
  const [d1, d2] = await Promise.all([
    createOrder(deps, scopeA, order(restA.branchId, "dup"), ownerActor),
    createOrder(deps, scopeA, order(restA.branchId, "dup"), ownerActor),
  ]);
  const { count: dupCount } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restA.id)
    .eq("idempotency_key", `dup-${RUN}`);
  check(
    "Same idempotency key twice at once → exactly one order",
    d1.ok && d2.ok && d1.data.id === d2.data.id && dupCount === 1 && [d1.data.duplicate, d2.data.duplicate].sort().join() === "false,true",
    JSON.stringify([d1, d2, dupCount]),
  );

  section("Orders: restaurant B can't see A's orders or customers");
  for (const table of ["orders", "order_items", "order_events", "payments", "customers", "customer_addresses"] as const) {
    const r = await ownerB.client.from(table).select("restaurant_id").eq("restaurant_id", restA.id);
    check(`B cannot read A's ${table}`, !r.error && r.data.length === 0, JSON.stringify(r));
  }
  const bTransition = await transitionOrder(
    { admin, pricing: ownerB.client },
    { restaurantId: restB.id, branchIds: [restB.branchId] },
    { orderId, expectedVersion: 1, path: ["preparing"] },
    { type: "staff", userId: ownerB.id, role: "owner" },
  );
  check("B's scope can't move A's order", !bTransition.ok && bTransition.code === "ORDER_NOT_FOUND", JSON.stringify(bTransition));

  section("Orders: kitchen sees orders without phone or address");
  const kOrders = await kitchenA.client.from("orders").select("id").eq("id", orderId);
  check("Kitchen can't read the orders table directly", !kOrders.error && kOrders.data.length === 0, JSON.stringify(kOrders));
  const kView = await kitchenA.client.from("kitchen_orders").select("*").eq("id", orderId);
  const row = kView.data?.[0] as Record<string, unknown> | undefined;
  check(
    "Kitchen reads kitchen_orders, which has no phone or address",
    !kView.error && !!row && !("customer_phone" in row) && !("address_text" in row) && !("landmark" in row),
    JSON.stringify(kView),
  );
  const kItems = await kitchenA.client.from("order_items").select("item_name").eq("order_id", orderId);
  check("Kitchen can read order items", !kItems.error && kItems.data.length === 1, JSON.stringify(kItems));
  const kCustomers = await kitchenA.client.from("customers").select("phone").eq("restaurant_id", restA.id);
  check("Kitchen can't read customers", !kCustomers.error && kCustomers.data.length === 0, JSON.stringify(kCustomers));
  const kPayments = await kitchenA.client.from("payments").select("id").eq("restaurant_id", restA.id);
  check("Kitchen can't read payments", !kPayments.error && kPayments.data.length === 0, JSON.stringify(kPayments));
  const bView = await ownerB.client.from("kitchen_orders").select("id").eq("restaurant_id", restA.id);
  check("B can't read A's kitchen_orders", !bView.error && bView.data.length === 0, JSON.stringify(bView));

  section("Orders: nobody writes orders from the browser");
  const c = ownerA.client;
  const insertOrder = await c.from("orders").insert({
    restaurant_id: restA.id,
    branch_id: restA.branchId,
    order_number: 99999,
    order_type: "pickup",
    source: "phone",
    status: "accepted",
    subtotal: 1,
    total: 1,
  });
  check("Owner can't insert an order directly", insertOrder.error !== null, JSON.stringify(insertOrder));
  const changeTotal = await c.from("orders").update({ total: 1, subtotal: 1 } as never).eq("id", orderId).select("id");
  const changeStatus = await c.from("orders").update({ status: "completed" } as never).eq("id", orderId).select("id");
  const { data: afterTamper } = await admin.from("orders").select("total, status").eq("id", orderId).single();
  check(
    "Owner can't change an order's total or status directly",
    (changeTotal.error !== null || changeTotal.data.length === 0) &&
      (changeStatus.error !== null || changeStatus.data.length === 0) &&
      afterTamper?.total === 105000 &&
      afterTamper.status === "accepted",
    JSON.stringify([changeTotal, changeStatus]),
  );
  const insertItem = await c.from("order_items").insert({
    restaurant_id: restA.id,
    order_id: orderId,
    item_id: dish!.id,
    item_name: "Free",
    quantity: 1,
    unit_price: 0,
    line_total: 0,
    snapshot: {},
  } as never);
  check("Owner can't add order items directly", insertItem.error !== null, JSON.stringify(insertItem));
  const insertPayment = await c
    .from("payments")
    .insert({ restaurant_id: restA.id, order_id: orderId, method: "cod", amount: 1, status: "paid" } as never);
  check("Owner can't insert payments directly", insertPayment.error !== null, JSON.stringify(insertPayment));
  const customerStats = await c.from("customers").update({ total_spent: 0, is_blocked: false } as never).eq("restaurant_id", restA.id).select("id");
  check("Owner can't edit customer stats or block flag directly", customerStats.error !== null, JSON.stringify(customerStats));
  const rpcCreate = await c.rpc("create_order", { p: { restaurant_id: restA.id } });
  const rpcMove = await c.rpc("transition_order_status", {
    p_restaurant_id: restA.id,
    p_order_id: orderId,
    p_expected_version: 1,
    p_path: ["completed"],
    p_actor_type: "staff",
  });
  const rpcPay = await c.rpc("record_payment", {
    p_restaurant_id: restA.id,
    p_order_id: orderId,
    p_method: "cod",
    p_amount: 1,
    p_reference: "",
    p_actor_user_id: ownerA.id,
  });
  check(
    "Order RPCs can't be called from the browser",
    rpcCreate.error !== null && rpcMove.error !== null && rpcPay.error !== null,
    JSON.stringify([rpcCreate.error, rpcMove.error, rpcPay.error]),
  );

  section("Orders: branch-limited staff");
  const a2 = await createOrder(deps, scopeA, order(branch2!.id, "a2", { orderType: "pickup", address: undefined, deliveryFee: 0 }), ownerActor);
  const sBranch1 = await staff2.client.from("orders").select("id").eq("id", orderId);
  const sBranch2 = await staff2.client.from("orders").select("id").eq("id", a2.ok ? a2.data.id : "");
  check("Branch-limited staff can't see another branch's orders", !sBranch1.error && sBranch1.data.length === 0, JSON.stringify(sBranch1));
  check("Branch-limited staff sees their own branch's orders", !sBranch2.error && sBranch2.data.length === 1, JSON.stringify(sBranch2));
  const sMove = await transitionOrder(
    { admin, pricing: staff2.client },
    { restaurantId: restA.id, branchIds: [branch2!.id] },
    { orderId, expectedVersion: 1, path: ["preparing"] },
    { type: "staff", userId: staff2.id, role: "staff" },
  );
  check("Branch-limited staff can't change another branch's order", !sMove.ok, JSON.stringify(sMove));

  section("Orders: concurrency and the state machine");
  const fresh = await createOrder(deps, scopeA, order(restA.branchId, "race", { orderType: "pickup", address: undefined, deliveryFee: 0 }), ownerActor, {
    initialStatus: "awaiting_acceptance",
  });
  const raceId = fresh.ok ? fresh.data.id : "";
  const [r1, r2] = await Promise.all([
    transitionOrder(deps, scopeA, { orderId: raceId, expectedVersion: 1, path: ["accepted"] }, ownerActor),
    transitionOrder(deps, scopeA, { orderId: raceId, expectedVersion: 1, path: ["accepted"] }, ownerActor),
  ]);
  const wins = [r1, r2].filter((r) => r.ok).length;
  const conflict = [r1, r2].find((r) => !r.ok);
  const { count: acceptEvents } = await admin
    .from("order_events")
    .select("id", { count: "exact", head: true })
    .eq("order_id", raceId)
    .eq("to_status", "accepted");
  check(
    "Two simultaneous Accepts → exactly one succeeds, the other gets VERSION_CONFLICT",
    wins === 1 && !!conflict && !conflict.ok && conflict.code === "VERSION_CONFLICT" && acceptEvents === 1,
    JSON.stringify([r1, r2, acceptEvents]),
  );

  const skip = await transitionOrder(deps, scopeA, { orderId: raceId, expectedVersion: 2, path: ["completed"] }, ownerActor);
  check("Database refuses skipping steps (accepted → completed)", !skip.ok && skip.code === "INVALID_TRANSITION", JSON.stringify(skip));
  const kitchenAccept = await transitionOrder(
    { admin, pricing: kitchenA.client },
    scopeA,
    { orderId: raceId, expectedVersion: 2, path: ["cancelled"], reason: "fake_order" },
    { type: "staff", userId: kitchenA.id, role: "kitchen" },
  );
  check("Kitchen can't cancel orders", !kitchenAccept.ok && kitchenAccept.code === "NOT_ALLOWED", JSON.stringify(kitchenAccept));

  const done = await transitionOrder(deps, scopeA, { orderId: raceId, expectedVersion: 2, path: ["preparing", "ready", "completed"] }, ownerActor);
  const { data: cust } = await admin
    .from("customers")
    .select("total_orders, total_spent")
    .eq("restaurant_id", restA.id)
    .eq("phone", "+923007654321")
    .single();
  check(
    "Completing an order updates the customer's totals",
    done.ok && cust?.total_orders === 1 && cust.total_spent === 90000,
    JSON.stringify([done, cust]),
  );
  const cancel = await transitionOrder(
    deps,
    scopeA,
    { orderId, expectedVersion: 1, path: ["cancelled"], reason: "fake_order" },
    ownerActor,
  );
  const { data: cust2 } = await admin.from("customers").select("cancelled_count").eq("restaurant_id", restA.id).eq("phone", "+923007654321").single();
  const { data: cancelAudit } = await admin.from("audit_logs").select("id").eq("entity_id", orderId).eq("action", "order.cancelled");
  check(
    "Fake-order cancel counts against the customer and is audit-logged",
    cancel.ok && cust2?.cancelled_count === 1 && (cancelAudit?.length ?? 0) === 1,
    JSON.stringify([cancel, cust2, cancelAudit]),
  );

  section("Kitchen screen: only START and READY");
  const kitchenDeps = { admin, pricing: kitchenA.client };
  const kitchenActor: Actor = { type: "staff", userId: kitchenA.id, role: "kitchen" };
  const ticket = await createOrder(deps, scopeA, order(restA.branchId, "kitchen", { orderType: "pickup", address: undefined, deliveryFee: 0 }), ownerActor, {
    initialStatus: "awaiting_acceptance",
  });
  const ticketId = ticket.ok ? ticket.data.id : "";
  const kAccept = await transitionOrder(kitchenDeps, scopeA, { orderId: ticketId, expectedVersion: 1, path: ["accepted"] }, kitchenActor);
  check("Kitchen can't accept new orders", !kAccept.ok && kAccept.code === "NOT_ALLOWED", JSON.stringify(kAccept));
  await transitionOrder(deps, scopeA, { orderId: ticketId, expectedVersion: 1, path: ["accepted"] }, ownerActor);
  const kStart = await transitionOrder(kitchenDeps, scopeA, { orderId: ticketId, expectedVersion: 2, path: ["preparing"] }, kitchenActor);
  check("Kitchen can START (accepted → preparing)", kStart.ok, JSON.stringify(kStart));
  const kReady = await transitionOrder(kitchenDeps, scopeA, { orderId: ticketId, expectedVersion: 3, path: ["ready"] }, kitchenActor);
  check("Kitchen can mark READY (preparing → ready)", kReady.ok, JSON.stringify(kReady));
  const kComplete = await transitionOrder(kitchenDeps, scopeA, { orderId: ticketId, expectedVersion: 4, path: ["completed"] }, kitchenActor);
  check("Kitchen can't complete or hand over orders", !kComplete.ok && kComplete.code === "NOT_ALLOWED", JSON.stringify(kComplete));
  // The database enforces the same rule even if the app check were skipped.
  const kDirect = await admin.rpc("transition_order_status", {
    p_restaurant_id: restA.id,
    p_order_id: ticketId,
    p_expected_version: 4,
    p_path: ["completed"],
    p_actor_type: "staff",
    p_actor_user_id: kitchenA.id,
  });
  check("Database refuses kitchen moves outside START/READY", kDirect.error?.message === "ROLE_NOT_ALLOWED", JSON.stringify(kDirect));

  const kRow = await kitchenA.client.from("kitchen_orders").select("*").eq("id", ticketId).single();
  const kRowKeys = Object.keys(kRow.data ?? {});
  check(
    "Kitchen ticket data has no phone, address or money",
    !kRow.error &&
      kRowKeys.includes("cancelled_at") &&
      !kRowKeys.some((k) => ["customer_phone", "address_text", "area", "landmark", "latitude", "longitude", "total", "subtotal"].includes(k)),
    JSON.stringify(kRowKeys),
  );
  const kEvents = await kitchenA.client.from("order_events").select("data").eq("order_id", ticketId);
  check(
    "Order events the kitchen reads contain no phone number",
    !kEvents.error && (kEvents.data?.length ?? 0) > 0 && !JSON.stringify(kEvents.data).includes("7654321"),
    JSON.stringify(kEvents.data),
  );
}

type Rest = { id: string; branchId: string; slug: string };

async function menuChecks(ownerA: TestUser, ownerB: TestUser, kitchenA: TestUser, restA: Rest, restB: Rest) {
  section("Menu: owner builds a menu");
  const cat = await ownerA.client
    .from("menu_categories")
    .insert({ restaurant_id: restA.id, name: "Burgers" })
    .select("id")
    .single();
  check("Owner A can create a category", !cat.error, JSON.stringify(cat.error));
  const categoryId = cat.data!.id;

  const grp = await ownerA.client.rpc("save_modifier_group", {
    p_restaurant_id: restA.id,
    p_group: { name: "Extras", min_select: 0, max_select: 2, options: [{ name: "Cheese", price_delta: 5000 }] },
  });
  check("Owner A can create an extras group", !grp.error, JSON.stringify(grp.error));

  const saved = await ownerA.client.rpc("save_menu_item", {
    p_restaurant_id: restA.id,
    p_item: {
      category_id: categoryId,
      name: "Zinger",
      base_price: null,
      sizes: [{ key: "r", name: "Regular", price: 55000, is_default: true }],
      group_ids: [grp.data],
      branches: [
        {
          branch_id: restA.branchId,
          is_hidden: false,
          is_available: true,
          price_override: null,
          size_prices: [{ size_key: "r", price: 60000 }],
        },
      ],
    },
  });
  check("Owner A can save an item with sizes, extras and branch prices", !saved.error, JSON.stringify(saved.error));
  const itemId = saved.data as string;
  const { data: variant } = await admin.from("item_variants").select("id").eq("item_id", itemId).single();

  section("Menu: restaurant B cannot see or change A's menu");
  const b = ownerB.client;
  for (const table of [
    "menu_categories",
    "menu_items",
    "item_variants",
    "modifier_groups",
    "modifier_options",
    "item_modifier_groups",
    "branch_item_settings",
    "branch_variant_prices",
  ] as const) {
    const r = await b.from(table).select("restaurant_id").eq("restaurant_id", restA.id);
    check(`B cannot read A's ${table}`, !r.error && r.data.length === 0, JSON.stringify(r));
  }

  const bPrice = await b.from("menu_items").update({ base_price: 1 }).eq("id", itemId).select("id");
  const bSize = await b.from("item_variants").update({ price: 1 }).eq("id", variant!.id).select("id");
  const { data: priceAfter } = await admin.from("item_variants").select("price").eq("id", variant!.id).single();
  check(
    "B cannot change A's prices",
    (bPrice.error !== null || bPrice.data.length === 0) &&
      (bSize.error !== null || bSize.data.length === 0) &&
      priceAfter?.price === 55000,
    JSON.stringify([bPrice, bSize]),
  );

  const bIntoA = await b
    .from("menu_items")
    .insert({ restaurant_id: restB.id, category_id: categoryId, name: "Sneaky" });
  check("B cannot put an item into A's category", bIntoA.error !== null, JSON.stringify(bIntoA));
  const bRpc = await b.rpc("save_menu_item", {
    p_restaurant_id: restA.id,
    p_item: { id: itemId, category_id: categoryId, name: "HACKED", base_price: 1, sizes: [], group_ids: [], branches: [] },
  });
  const { data: nameAfter } = await admin.from("menu_items").select("name").eq("id", itemId).single();
  check(
    "B cannot edit A's item through save_menu_item",
    bRpc.error !== null && nameAfter?.name === "Zinger",
    JSON.stringify(bRpc.error),
  );
  const bStock = await b.rpc("set_item_stock", { p_branch_id: restA.branchId, p_item_id: itemId, p_is_available: false });
  check("B cannot change A's stock", bStock.error !== null, JSON.stringify(bStock));

  section("Menu: kitchen can toggle stock, nothing else");
  const k = kitchenA.client;
  const kStock = await k.rpc("set_item_stock", { p_branch_id: restA.branchId, p_item_id: itemId, p_is_available: false });
  const { data: stockAfter } = await admin
    .from("branch_item_settings")
    .select("is_available")
    .eq("branch_id", restA.branchId)
    .eq("item_id", itemId)
    .single();
  check(
    "Kitchen can mark an item out of stock",
    !kStock.error && stockAfter?.is_available === false,
    JSON.stringify(kStock.error),
  );

  const { data: stockAudit } = await admin
    .from("audit_logs")
    .select("user_id, new_data")
    .eq("action", "menu_item.stock_changed")
    .eq("entity_id", itemId);
  check(
    "Stock change is audit-logged with who and which branch",
    !!stockAudit?.some(
      (a) => a.user_id === kitchenA.id && (a.new_data as { branch_id?: string } | null)?.branch_id === restA.branchId,
    ),
    JSON.stringify(stockAudit),
  );

  const kDirect = await k
    .from("branch_item_settings")
    .update({ price_override: 1, is_hidden: true })
    .eq("item_id", itemId)
    .select("item_id");
  check(
    "Kitchen cannot edit branch settings directly",
    kDirect.error !== null || kDirect.data.length === 0,
    JSON.stringify(kDirect),
  );

  const kPrice = await k.from("menu_items").update({ base_price: 1 }).eq("id", itemId).select("id");
  const kVariant = await k.from("item_variants").update({ price: 1 }).eq("id", variant!.id).select("id");
  const kBranchPrice = await k
    .from("branch_variant_prices")
    .update({ price: 1 })
    .eq("variant_id", variant!.id)
    .select("variant_id");
  const kName = await k.from("menu_items").update({ name: "Kitchen Special" }).eq("id", itemId).select("id");
  const { data: kAfter } = await admin.from("menu_items").select("name, base_price").eq("id", itemId).single();
  check(
    "Kitchen cannot change prices",
    [kPrice, kVariant, kBranchPrice].every((r) => r.error !== null || r.data.length === 0) &&
      kAfter?.base_price === null,
    JSON.stringify([kPrice, kVariant, kBranchPrice]),
  );
  check(
    "Kitchen cannot rename items",
    (kName.error !== null || kName.data.length === 0) && kAfter?.name === "Zinger",
    JSON.stringify(kName),
  );

  const kCat = await k.from("menu_categories").insert({ restaurant_id: restA.id, name: "Kitchen" });
  check("Kitchen cannot create categories", kCat.error !== null, JSON.stringify(kCat));
  const kSave = await k.rpc("save_menu_item", {
    p_restaurant_id: restA.id,
    p_item: { id: itemId, category_id: categoryId, name: "Kitchen", base_price: 1, sizes: [], group_ids: [], branches: [] },
  });
  check("Kitchen cannot edit items through save_menu_item", kSave.error !== null, JSON.stringify(kSave.error));

  section("Menu: soft delete only");
  const del = await ownerA.client.from("menu_items").delete().eq("id", itemId).select("id");
  const delVariant = await ownerA.client.from("item_variants").delete().eq("id", variant!.id).select("id");
  const { data: stillThere } = await admin.from("menu_items").select("id").eq("id", itemId);
  check(
    "Owner cannot hard-delete items or sizes",
    (del.error !== null || del.data.length === 0) &&
      (delVariant.error !== null || delVariant.data.length === 0) &&
      stillThere?.length === 1,
    JSON.stringify([del, delVariant]),
  );

  section("Public menu (get_public_menu)");
  const anon = createClient<Database>(url!, publishableKey!, noSession);
  const anonTable = await anon.from("menu_items").select("id");
  check(
    "Anonymous users cannot read menu tables directly",
    anonTable.error !== null || anonTable.data.length === 0,
    JSON.stringify(anonTable),
  );

  type PublicMenu = {
    categories: { items: { name: string; is_available: boolean; sizes: { price: number }[] }[] }[];
  } | null;
  const pub = await anon.rpc("get_public_menu", { p_restaurant_slug: restA.slug, p_branch_id: restA.branchId });
  const pubItem = (pub.data as PublicMenu)?.categories[0]?.items[0];
  check(
    "Public menu shows the item with its branch size price and stock",
    !pub.error && pubItem?.name === "Zinger" && pubItem.sizes[0]?.price === 60000 && pubItem.is_available === false,
    JSON.stringify(pub),
  );
  const wrongBranch = await anon.rpc("get_public_menu", { p_restaurant_slug: restA.slug, p_branch_id: restB.branchId });
  check(
    "Public menu returns nothing for another restaurant's branch",
    !wrongBranch.error && wrongBranch.data === null,
    JSON.stringify(wrongBranch),
  );

  await admin.from("restaurants").update({ status: "suspended" }).eq("id", restA.id);
  const suspended = await anon.rpc("get_public_menu", { p_restaurant_slug: restA.slug, p_branch_id: restA.branchId });
  check(
    "Public menu returns nothing for a suspended restaurant",
    !suspended.error && suspended.data === null,
    JSON.stringify(suspended),
  );
  const suspendedInfo = await anon.rpc("get_public_menu_info", { p_slug: restA.slug });
  check("Menu page info is empty for a suspended restaurant", !suspendedInfo.error && suspendedInfo.data === null, JSON.stringify(suspendedInfo));
  await admin.from("restaurants").update({ status: "trial" }).eq("id", restA.id); // back to normal for later checks
}

async function whatsappChecks(ownerA: TestUser, ownerB: TestUser, kitchenA: TestUser, restA: Rest) {
  section("WhatsApp: setup");
  const phoneNumberId = `9${Date.now()}`;
  const token = `EAAG-test-token-${RUN}`;
  const acc = await admin.from("whatsapp_accounts").insert({
    restaurant_id: restA.id,
    branch_id: restA.branchId,
    phone_number_id: phoneNumberId,
    waba_id: "1234567890",
    display_phone_number: "+92 300 0000000",
    access_token_encrypted: encryptToken(token),
  });
  check("Server can connect a WhatsApp number to restaurant A", acc.error === null, JSON.stringify(acc.error));

  const inbound = (waMessageId: string) =>
    admin
      .rpc("whatsapp_record_inbound", {
        p_restaurant_id: restA.id,
        p_wa_id: "923009990001",
        p_phone: "+923009990001",
        p_profile_name: "WA Customer",
        p_wa_message_id: waMessageId,
        p_type: "text",
        p_body: "Assalam o alaikum, menu?",
        p_media_id: null as unknown as string,
        p_raw: { test: true },
        p_sent_at: new Date().toISOString(),
      })
      .single();
  const first = await inbound(`wamid.rls-${RUN}`);
  check(
    "Inbound message is saved with customer + conversation",
    !first.error && first.data?.duplicate === false && !!first.data.customer_id,
    JSON.stringify(first),
  );
  const again = await inbound(`wamid.rls-${RUN}`);
  const { count } = await admin
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("wa_message_id", `wamid.rls-${RUN}`);
  check("Same wa_message_id twice → duplicate, saved once", again.data?.duplicate === true && count === 1, JSON.stringify({ again, count }));
  const conversationId = first.data!.conversation_id;
  const claim1 = await admin.rpc("whatsapp_claim_auto_reply", { p_conversation_id: conversationId });
  const claim2 = await admin.rpc("whatsapp_claim_auto_reply", { p_conversation_id: conversationId });
  check("Auto-reply claim succeeds once per 6 hours", claim1.data === true && claim2.data === false, JSON.stringify({ claim1, claim2 }));
  await admin.from("whatsapp_webhook_events").insert({ raw: { rls: RUN } });

  section("WhatsApp: tenant isolation and token secrecy");
  const ownStatus = await ownerA.client
    .from("whatsapp_accounts")
    .select("display_phone_number, is_active")
    .eq("restaurant_id", restA.id);
  check("Owner A can see their connection status and number", !ownStatus.error && ownStatus.data.length === 1, JSON.stringify(ownStatus));
  const tokenRead = await ownerA.client.from("whatsapp_accounts").select("access_token_encrypted");
  check("Owner A can NEVER read the access token column", tokenRead.error !== null, JSON.stringify(tokenRead));
  const starRead = await ownerA.client.from("whatsapp_accounts").select("*");
  check("select * on whatsapp_accounts is refused (token not granted)", starRead.error !== null, JSON.stringify(starRead.data));
  const ownConv = await ownerA.client.from("whatsapp_conversations").select("id").eq("id", conversationId);
  const ownMsg = await ownerA.client.from("whatsapp_messages").select("id, body").eq("conversation_id", conversationId);
  check(
    "Owner A can read their conversations and messages",
    ownConv.data?.length === 1 && ownMsg.data?.length === 1,
    JSON.stringify({ ownConv, ownMsg }),
  );

  const bAcc = await ownerB.client.from("whatsapp_accounts").select("id, display_phone_number");
  const bConv = await ownerB.client.from("whatsapp_conversations").select("id");
  const bMsg = await ownerB.client.from("whatsapp_messages").select("id");
  check("Restaurant B cannot see the WhatsApp connection of A", !bAcc.error && bAcc.data.length === 0, JSON.stringify(bAcc));
  check("Restaurant B cannot see conversations of A", !bConv.error && bConv.data.length === 0, JSON.stringify(bConv));
  check("Restaurant B cannot see messages of A", !bMsg.error && bMsg.data.length === 0, JSON.stringify(bMsg));

  const kConv = await kitchenA.client.from("whatsapp_conversations").select("id");
  const kMsg = await kitchenA.client.from("whatsapp_messages").select("id");
  check(
    "Kitchen cannot read customer chats",
    (kConv.data?.length ?? 0) === 0 && (kMsg.data?.length ?? 0) === 0,
    JSON.stringify({ kConv, kMsg }),
  );

  const events = await ownerA.client.from("whatsapp_webhook_events").select("id");
  check("Owners cannot read raw webhook events (super admin only)", !events.error && events.data.length === 0, JSON.stringify(events));

  section("WhatsApp: nobody writes from the browser");
  const insMsg = await ownerA.client.from("whatsapp_messages").insert({
    restaurant_id: restA.id,
    conversation_id: conversationId,
    direction: "outbound",
    body: "fake",
    status: "sent",
  });
  check("Owner cannot insert messages", insMsg.error !== null, JSON.stringify(insMsg));
  const updConv = await ownerA.client
    .from("whatsapp_conversations")
    .update({ bot_enabled: false })
    .eq("id", conversationId)
    .select("id");
  check("Owner cannot change conversations", updConv.error !== null || updConv.data?.length === 0, JSON.stringify(updConv));
  const updAcc = await ownerA.client
    .from("whatsapp_accounts")
    .update({ phone_number_id: "1111111" })
    .eq("restaurant_id", restA.id)
    .select("id");
  check("Owner cannot edit the WhatsApp connection", updAcc.error !== null || updAcc.data?.length === 0, JSON.stringify(updAcc));
  const insAcc = await ownerB.client.from("whatsapp_accounts").insert({
    restaurant_id: restA.id,
    phone_number_id: "22222222",
    waba_id: "33333333",
    display_phone_number: "+92 300 1111111",
    access_token_encrypted: "x",
  });
  check("Owners cannot create WhatsApp connections", insAcc.error !== null, JSON.stringify(insAcc));
  const rpc = await ownerA.client.rpc("whatsapp_record_inbound", {
    p_restaurant_id: restA.id,
    p_wa_id: "923009990002",
    p_phone: "+923009990002",
    p_profile_name: "x",
    p_wa_message_id: `wamid.forged-${RUN}`,
    p_type: "text",
    p_body: "forged",
    p_media_id: "",
    p_raw: {},
    p_sent_at: new Date().toISOString(),
  });
  check("Users cannot call whatsapp_record_inbound", rpc.error !== null, JSON.stringify(rpc));
  const claim = await ownerA.client.rpc("whatsapp_claim_auto_reply", { p_conversation_id: conversationId });
  check("Users cannot call whatsapp_claim_auto_reply", claim.error !== null, JSON.stringify(claim));
  const anon = createClient<Database>(url!, publishableKey!, noSession);
  const anonMsg = await anon.from("whatsapp_messages").select("id");
  check("Anonymous users cannot read messages", anonMsg.error !== null || anonMsg.data.length === 0, JSON.stringify(anonMsg));
  const updMedia = await ownerA.client
    .from("whatsapp_messages")
    .update({ media_url: `${restA.id}/forged.png` })
    .eq("conversation_id", conversationId)
    .select("id");
  check("Owner cannot change a message's media link", updMedia.error !== null || updMedia.data?.length === 0, JSON.stringify(updMedia));

  section("WhatsApp: customer media (private bucket)");
  const mediaPath = `${restA.id}/rls-${RUN}.png`;
  const up = await admin.storage.from(MEDIA_BUCKET).upload(mediaPath, new Uint8Array([137, 80, 78, 71]), { contentType: "image/png" });
  if (!up.error) uploadedMediaPaths.push(mediaPath);
  check("Server can store customer media under {restaurant_id}/", up.error === null, JSON.stringify(up.error));
  const signA = await ownerA.client.storage.from(MEDIA_BUCKET).createSignedUrl(mediaPath, 3600);
  const fetched = signA.data ? await fetch(signA.data.signedUrl) : null;
  check("Owner A gets a working 1-hour link to their media", fetched?.status === 200, JSON.stringify(signA.error));
  const signB = await ownerB.client.storage.from(MEDIA_BUCKET).createSignedUrl(mediaPath, 3600);
  check("Restaurant B cannot open A's media", signB.error !== null, JSON.stringify(signB.data));
  const signK = await kitchenA.client.storage.from(MEDIA_BUCKET).createSignedUrl(mediaPath, 3600);
  check("Kitchen cannot open customer media", signK.error !== null, JSON.stringify(signK.data));
  const signAnon = await anon.storage.from(MEDIA_BUCKET).createSignedUrl(mediaPath, 3600);
  check("Anonymous users cannot open media", signAnon.error !== null, JSON.stringify(signAnon.data));
  const publicRead = await fetch(anon.storage.from(MEDIA_BUCKET).getPublicUrl(mediaPath).data.publicUrl);
  check("The media bucket is not public", publicRead.status !== 200, String(publicRead.status));
  const ownerUpload = await ownerA.client.storage.from(MEDIA_BUCKET).upload(`${restA.id}/forged-${RUN}.png`, new Uint8Array([1]));
  if (!ownerUpload.error) uploadedMediaPaths.push(`${restA.id}/forged-${RUN}.png`);
  check("Users cannot upload into the media bucket (server only)", ownerUpload.error !== null, JSON.stringify(ownerUpload.data));

  section("WhatsApp: order message settings");
  const settings = { accepted: true, preparing: false, ready: true, out_for_delivery: true, delivered: true, cancelled: true };
  const ownSet = await ownerA.client.from("restaurants").update({ whatsapp_status_messages: settings }).eq("id", restA.id).select("id");
  check("Owner A can switch order messages on/off", !ownSet.error && ownSet.data.length === 1, JSON.stringify(ownSet));
  const badSet = await ownerA.client.from("restaurants").update({ whatsapp_status_messages: [] }).eq("id", restA.id).select("id");
  check("Order message settings must be an object", badSet.error !== null, JSON.stringify(badSet));
  const kSet = await kitchenA.client.from("restaurants").update({ whatsapp_status_messages: {} }).eq("id", restA.id).select("id");
  check("Kitchen cannot change order message settings", kSet.error !== null || kSet.data?.length === 0, JSON.stringify(kSet));
  const bSet = await ownerB.client.from("restaurants").update({ whatsapp_status_messages: {} }).eq("id", restA.id).select("id");
  check("Restaurant B cannot change A's order message settings", bSet.error !== null || bSet.data?.length === 0, JSON.stringify(bSet));
}

async function cleanup() {
  section("Cleanup");
  if (uploadedPaths.length) await admin.storage.from(LOGO_BUCKET).remove(uploadedPaths);
  if (uploadedMediaPaths.length) await admin.storage.from(MEDIA_BUCKET).remove(uploadedMediaPaths);
  if (uploadedBotMediaPaths.length) await admin.storage.from(BOT_MEDIA_BUCKET).remove(uploadedBotMediaPaths);
  await admin.from("whatsapp_webhook_events").delete().eq("raw->>rls", RUN);
  if (createdRestaurantIds.length) {
    const { error } = await admin.from("restaurants").delete().in("id", createdRestaurantIds);
    if (error) console.log(`  ! could not delete restaurants: ${error.message}`);
  }
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log(`  ! could not delete user ${id}: ${error.message}`);
  }
  console.log(`  Removed ${createdRestaurantIds.length} restaurants, ${createdUserIds.length} users, ${uploadedPaths.length} files.`);
}

async function run() {
  let crashed = false;
  try {
    await main();
  } catch (err) {
    crashed = true;
    console.error("\n\x1b[31mTest crashed:\x1b[0m", err);
  } finally {
    await cleanup();
  }

  const failed = results.filter((r) => !r.pass);
  const ok = failed.length === 0 && !crashed;
  console.log(
    `\n${ok ? "\x1b[32mALL PASSED\x1b[0m" : "\x1b[31mFAILED\x1b[0m"}  ${results.length - failed.length}/${results.length} checks passed`,
  );
  process.exit(ok ? 0 : 1);
}

void run();

async function botChecks(ownerA: TestUser, ownerB: TestUser, kitchenA: TestUser, restA: Rest) {
  section("Bot: sessions and AI logs are private to the restaurant");
  const sess = await admin
    .from("bot_sessions")
    .insert({ restaurant_id: restA.id, branch_id: restA.branchId, cart: [{ lineId: "L1", name: "Zinger" }] })
    .select("id")
    .single();
  check("Server can create a bot session", !sess.error && !!sess.data, JSON.stringify(sess.error));
  const log = await admin.from("ai_logs").insert({ restaurant_id: restA.id, session_id: sess.data?.id, input_text: "2 zinger", model: "test" });
  check("Server can write an AI log", log.error === null, JSON.stringify(log.error));

  const ownSess = await ownerA.client.from("bot_sessions").select("id, cart").eq("restaurant_id", restA.id);
  const ownLogs = await ownerA.client.from("ai_logs").select("id").eq("restaurant_id", restA.id);
  check("Owner A can read their bot sessions", !ownSess.error && ownSess.data.length === 1, JSON.stringify(ownSess));
  check("Owner A can read their AI logs", !ownLogs.error && ownLogs.data.length === 1, JSON.stringify(ownLogs));
  const bSess = await ownerB.client.from("bot_sessions").select("id").eq("restaurant_id", restA.id);
  const bLogs = await ownerB.client.from("ai_logs").select("id").eq("restaurant_id", restA.id);
  check("Restaurant B cannot read the bot sessions of A", !bSess.error && bSess.data.length === 0, JSON.stringify(bSess));
  check("Restaurant B cannot read the AI logs of A", !bLogs.error && bLogs.data.length === 0, JSON.stringify(bLogs));
  const kSess = await kitchenA.client.from("bot_sessions").select("id");
  const kLogs = await kitchenA.client.from("ai_logs").select("id");
  check(
    "Kitchen cannot read bot sessions or AI logs",
    (kSess.data?.length ?? 0) === 0 && (kLogs.data?.length ?? 0) === 0,
    JSON.stringify({ kSess, kLogs }),
  );
  const anon = createClient<Database>(url!, publishableKey!, noSession);
  const anonSess = await anon.from("bot_sessions").select("id");
  check("Anonymous users cannot read bot sessions", anonSess.error !== null || anonSess.data.length === 0, JSON.stringify(anonSess));

  section("Bot: nobody writes bot data or risk flags from the browser");
  const insSess = await ownerA.client.from("bot_sessions").insert({ restaurant_id: restA.id, branch_id: restA.branchId });
  check("Owner cannot create bot sessions", insSess.error !== null, JSON.stringify(insSess));
  const updSess = await ownerA.client.from("bot_sessions").update({ status: "completed" }).eq("id", sess.data!.id).select("id");
  check("Owner cannot change a bot session (e.g. its cart)", updSess.error !== null || updSess.data?.length === 0, JSON.stringify(updSess));
  const insLog = await ownerA.client.from("ai_logs").insert({ restaurant_id: restA.id, input_text: "x" });
  check("Owner cannot write AI logs", insLog.error !== null, JSON.stringify(insLog));
  const { data: anyOrder } = await admin.from("orders").select("id").eq("restaurant_id", restA.id).limit(1).maybeSingle();
  if (anyOrder) {
    const upd = await ownerA.client.from("orders").update({ risk_flag: null }).eq("id", anyOrder.id).select("id");
    check("Owner cannot clear the risk flag of an order", upd.error !== null || upd.data?.length === 0, JSON.stringify(upd));
  }

  section("Bot: settings");
  const fee = await ownerA.client
    .from("branches")
    .update({ default_delivery_fee: 20000, minimum_order: 60000 })
    .eq("id", restA.branchId)
    .select("id");
  check("Owner can set the branch delivery fee and minimum order", !fee.error && fee.data.length === 1, JSON.stringify(fee));
  const badFee = await ownerA.client.from("branches").update({ default_delivery_fee: -1 }).eq("id", restA.branchId).select("id");
  check("Delivery fee cannot be negative", badFee.error !== null, JSON.stringify(badFee));
  const kFee = await kitchenA.client.from("branches").update({ default_delivery_fee: 0 }).eq("id", restA.branchId).select("id");
  check("Kitchen cannot change delivery fees", kFee.error !== null || kFee.data?.length === 0, JSON.stringify(kFee));
  const bot = await ownerA.client
    .from("restaurants")
    .update({ bot_enabled: false, high_value_cod_threshold: 800000 })
    .eq("id", restA.id)
    .select("id");
  check("Owner can switch the bot off and set the high-value limit", !bot.error && bot.data.length === 1, JSON.stringify(bot));
  const bBot = await ownerB.client.from("restaurants").update({ bot_enabled: true }).eq("id", restA.id).select("id");
  check("Restaurant B cannot switch the bot of A", bBot.error !== null || bBot.data?.length === 0, JSON.stringify(bBot));

  section("Voice notes: transcripts are written by the server only");
  const { data: anyMsg } = await admin.from("whatsapp_messages").select("id").eq("restaurant_id", restA.id).limit(1).maybeSingle();
  if (anyMsg) {
    const tr = await ownerA.client.from("whatsapp_messages").update({ transcript: "forged" }).eq("id", anyMsg.id).select("id");
    check("Staff cannot change a voice transcript", tr.error !== null || tr.data?.length === 0, JSON.stringify(tr));
  }
  const tlog = await ownerA.client.from("ai_logs").insert({ restaurant_id: restA.id, type: "transcription", input_text: "x" });
  check("Nobody logs transcriptions from the browser", tlog.error !== null, JSON.stringify(tlog));

  section("Bot on WhatsApp: corrections, budget, lock");
  const budget = await ownerA.client.from("restaurants").update({ ai_monthly_budget_usd: 1000 }).eq("id", restA.id).select("id");
  check("Owners cannot set their own AI budget (super admin only)", budget.error !== null, JSON.stringify(budget));
  const lock = await ownerA.client.rpc("bot_claim_conversation", { p_conversation_id: sess.data!.id, p_ttl_seconds: 60 });
  check("Users cannot call bot_claim_conversation", lock.error !== null, JSON.stringify(lock));
  const usage = await ownerA.client.rpc("ai_usage_summary", { p_since: new Date(0).toISOString() });
  check("Users cannot call ai_usage_summary", usage.error !== null, JSON.stringify(usage));
  const svcUsage = await admin.rpc("ai_usage_summary", { p_since: new Date(0).toISOString(), p_restaurant_id: restA.id });
  check("Server can read AI usage per restaurant", !svcUsage.error && svcUsage.data?.[0]?.input_tokens !== undefined, JSON.stringify(svcUsage));
  const { data: convA } = await admin.from("whatsapp_conversations").select("id").eq("restaurant_id", restA.id).limit(1).maybeSingle();
  if (convA) {
    const claim1 = await admin.rpc("bot_claim_conversation", { p_conversation_id: convA.id, p_ttl_seconds: 60 });
    const claim2 = await admin.rpc("bot_claim_conversation", { p_conversation_id: convA.id, p_ttl_seconds: 60 });
    check("Chat lock: only one bot turn at a time", claim1.data === true && claim2.data === false, JSON.stringify({ claim1, claim2 }));
    await admin.from("whatsapp_conversations").update({ bot_lock_until: null }).eq("id", convA.id);
    const resume = await ownerA.client
      .from("whatsapp_conversations")
      .update({ bot_enabled: true, handoff_reason: null })
      .eq("id", convA.id)
      .select("id");
    check("Staff can't switch a chat's bot directly (only via the server action)", resume.error !== null || resume.data?.length === 0, JSON.stringify(resume));
  }
  if (anyOrder) {
    const corr = await admin
      .from("ai_corrections")
      .insert({ restaurant_id: restA.id, order_id: anyOrder.id, session_id: sess.data!.id, before: { lines: [] }, after: { lines: [{ item: "Zinger" }] } })
      .select("id")
      .single();
    check("Server can save an AI correction", !corr.error, JSON.stringify(corr.error));
    const ownCorr = await ownerA.client.from("ai_corrections").select("id").eq("restaurant_id", restA.id);
    const bCorr = await ownerB.client.from("ai_corrections").select("id").eq("restaurant_id", restA.id);
    const kCorr = await kitchenA.client.from("ai_corrections").select("id");
    check("Owner A can read their AI corrections", !ownCorr.error && ownCorr.data.length === 1, JSON.stringify(ownCorr));
    check("Restaurant B cannot read the AI corrections of A", !bCorr.error && bCorr.data.length === 0, JSON.stringify(bCorr));
    check("Kitchen cannot read AI corrections", (kCorr.data?.length ?? 0) === 0, JSON.stringify(kCorr));
    const insCorr = await ownerA.client.from("ai_corrections").insert({ restaurant_id: restA.id, order_id: anyOrder.id, before: {}, after: {} });
    check("Nobody writes AI corrections from the browser", insCorr.error !== null, JSON.stringify(insCorr));
  }
}

/** Phase 7C: menu images, offers, FAQs — members read, owner/manager write, other restaurants nothing. */
async function knowledgeChecks(ownerA: TestUser, ownerB: TestUser, kitchenA: TestUser, restA: Rest) {
  section("Bot knowledge: owner manages offers, FAQs and menu images");
  const riderA = await makeUser("rider-a");
  const addRider = await ownerA.client.from("memberships").insert({ user_id: riderA.id, restaurant_id: restA.id, role: "rider" });
  check("Owner A can add a rider", addRider.error === null, JSON.stringify(addRider.error));

  const { data: item } = await admin.from("menu_items").select("id").eq("restaurant_id", restA.id).is("archived_at", null).limit(1).single();
  const offer = await ownerA.client
    .from("offers")
    .insert({ restaurant_id: restA.id, title: "Friday Deal", menu_item_id: item!.id, days_of_week: [5] })
    .select("id")
    .single();
  check("Owner A can create an offer linked to a menu item", !offer.error && !!offer.data, JSON.stringify(offer.error));
  const { data: itemB } = await admin.from("menu_items").select("id").neq("restaurant_id", restA.id).limit(1).maybeSingle();
  if (itemB) {
    const crossItem = await ownerA.client.from("offers").insert({ restaurant_id: restA.id, title: "Stolen", menu_item_id: itemB.id });
    check("An offer can't point at another restaurant's item", crossItem.error !== null, JSON.stringify(crossItem));
  }
  const noItem = await ownerA.client.from("offers").insert({ restaurant_id: restA.id, title: "No item" } as never);
  check("An offer needs a menu item", noItem.error !== null, JSON.stringify(noItem));
  const halfTime = await ownerA.client.from("offers").insert({ restaurant_id: restA.id, title: "Half", menu_item_id: item!.id, start_time: "12:00" });
  check("Offer times are both set or both empty", halfTime.error !== null, JSON.stringify(halfTime));

  const faq = await ownerA.client
    .from("restaurant_faqs")
    .insert({ restaurant_id: restA.id, question: "Parking?", answer: "Yes", keywords: ["parking"] })
    .select("id")
    .single();
  check("Owner A can add an FAQ", !faq.error && !!faq.data, JSON.stringify(faq.error));

  const path = `${restA.id}/menu/rls-${RUN}.jpg`;
  const jpeg = () => new Blob([new Uint8Array([255, 216, 255, 224])], { type: "image/jpeg" });
  const up = await ownerA.client.storage.from(BOT_MEDIA_BUCKET).upload(path, jpeg());
  if (!up.error) uploadedBotMediaPaths.push(path);
  check("Owner A can upload a menu image to their folder", up.error === null, JSON.stringify(up.error));
  const media = await ownerA.client
    .from("menu_media")
    .insert({ restaurant_id: restA.id, type: "image", storage_path: path, file_name: "menu.jpg", size_bytes: 4 })
    .select("id")
    .single();
  check("Owner A can save a menu image", !media.error && !!media.data, JSON.stringify(media.error));
  const pub = await fetch(admin.storage.from(BOT_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl);
  check("Menu images are public (WhatsApp fetches them by URL)", pub.ok, String(pub.status));
  const backdate = await ownerA.client
    .from("menu_media")
    .update({ uploaded_at: "2020-01-01T00:00:00Z" } as never)
    .eq("id", media.data!.id)
    .select("id");
  check("Nobody back-dates a menu image (uploaded_at is not writable)", backdate.error !== null, JSON.stringify(backdate));
  const exePath = `${restA.id}/menu/rls-${RUN}.exe`;
  const exe = await ownerA.client.storage.from(BOT_MEDIA_BUCKET).upload(exePath, new Blob(["MZ"], { type: "application/x-msdownload" }));
  if (!exe.error) uploadedBotMediaPaths.push(exePath);
  check("Only images and PDFs can be uploaded to bot-media", exe.error !== null, JSON.stringify(exe.data));

  section("Bot knowledge: restaurant B can't see or change A's");
  const rows = [
    ["offers", offer.data!.id],
    ["restaurant_faqs", faq.data!.id],
    ["menu_media", media.data!.id],
  ] as const;
  for (const [table, id] of rows) {
    const read = await ownerB.client.from(table).select("id").eq("id", id);
    check(`Restaurant B cannot read A's ${table}`, !read.error && read.data.length === 0, JSON.stringify(read));
    const upd = await ownerB.client.from(table).update({ sort_order: 99 }).eq("id", id).select("id");
    check(`Restaurant B cannot edit A's ${table}`, upd.error !== null || upd.data.length === 0, JSON.stringify(upd));
    const del = await ownerB.client.from(table).delete().eq("id", id).select("id");
    check(`Restaurant B cannot delete A's ${table}`, del.error !== null || del.data.length === 0, JSON.stringify(del));
  }
  const bIns = await ownerB.client.from("restaurant_faqs").insert({ restaurant_id: restA.id, question: "Hacked?", answer: "Yes" });
  check("Restaurant B cannot add FAQs to A", bIns.error !== null, JSON.stringify(bIns));
  const bOffer = await ownerB.client.from("offers").insert({ restaurant_id: restA.id, title: "Fake deal", menu_item_id: item!.id });
  check("Restaurant B cannot add offers to A", bOffer.error !== null, JSON.stringify(bOffer));
  const bPath = `${restA.id}/menu/b-${RUN}.jpg`;
  const bUp = await ownerB.client.storage.from(BOT_MEDIA_BUCKET).upload(bPath, jpeg());
  if (!bUp.error) uploadedBotMediaPaths.push(bPath);
  check("Restaurant B cannot upload into A's bot-media folder", bUp.error !== null, JSON.stringify(bUp.data));
  const bRm = await ownerB.client.storage.from(BOT_MEDIA_BUCKET).remove([path]);
  const stillThere = await admin.storage.from(BOT_MEDIA_BUCKET).list(`${restA.id}/menu`, { search: `rls-${RUN}.jpg` });
  check(
    "Restaurant B cannot delete A's menu image file",
    (bRm.data?.length ?? 0) === 0 && (stillThere.data?.length ?? 0) === 1,
    JSON.stringify({ bRm: bRm.data, stillThere: stillThere.data?.length }),
  );
  const since = new Date(0).toISOString();
  const bRpc = await ownerB.client.rpc("bot_bestsellers", { p_restaurant_id: restA.id, p_branch_id: restA.branchId, p_since: since });
  check("Users cannot call bot_bestsellers (server only)", bRpc.error !== null, JSON.stringify(bRpc));
  const svcRpc = await admin.rpc("bot_bestsellers", { p_restaurant_id: restA.id, p_branch_id: restA.branchId, p_since: since });
  check("Server can read bestsellers", !svcRpc.error && Array.isArray(svcRpc.data), JSON.stringify(svcRpc.error));

  section("Bot knowledge: kitchen and rider can read but not edit");
  const staffUsers = [
    ["Kitchen", kitchenA],
    ["Rider", riderA],
  ] as const;
  for (const [label, user] of staffUsers) {
    const read = await user.client.from("offers").select("id").eq("restaurant_id", restA.id);
    check(`${label} can read offers`, !read.error && read.data.length === 1, JSON.stringify(read));
    const updO = await user.client.from("offers").update({ title: "Free food" }).eq("id", offer.data!.id).select("id");
    check(`${label} cannot edit offers`, updO.error !== null || updO.data.length === 0, JSON.stringify(updO));
    const updF = await user.client.from("restaurant_faqs").update({ answer: "No" }).eq("id", faq.data!.id).select("id");
    check(`${label} cannot edit FAQs`, updF.error !== null || updF.data.length === 0, JSON.stringify(updF));
    const insF = await user.client.from("restaurant_faqs").insert({ restaurant_id: restA.id, question: "New?", answer: "x" });
    check(`${label} cannot add FAQs`, insF.error !== null, JSON.stringify(insF));
    const delM = await user.client.from("menu_media").delete().eq("id", media.data!.id).select("id");
    check(`${label} cannot remove menu images`, delM.error !== null || delM.data.length === 0, JSON.stringify(delM));
    const p = `${restA.id}/menu/${label}-${RUN}.jpg`;
    const upM = await user.client.storage.from(BOT_MEDIA_BUCKET).upload(p, jpeg());
    if (!upM.error) uploadedBotMediaPaths.push(p);
    check(`${label} cannot upload menu images`, upM.error !== null, JSON.stringify(upM.data));
    const rest = await user.client.from("restaurants").update({ payment_methods: ["cod"] }).eq("id", restA.id).select("id");
    check(`${label} cannot change payment methods`, rest.error !== null || rest.data.length === 0, JSON.stringify(rest));
  }

  section("Bot knowledge: restaurant info settings");
  const info = await ownerA.client
    .from("restaurants")
    .update({ dine_in_available: false, payment_methods: ["cod"], mention_offer_on_greeting: false })
    .eq("id", restA.id)
    .select("id");
  check("Owner can set dine-in, payment methods and the greeting offer", !info.error && info.data.length === 1, JSON.stringify(info));
  const noPay = await ownerA.client.from("restaurants").update({ payment_methods: [] }).eq("id", restA.id).select("id");
  check("At least one payment method is required", noPay.error !== null, JSON.stringify(noPay));
  const badPay = await ownerA.client.from("restaurants").update({ payment_methods: ["bitcoin"] }).eq("id", restA.id).select("id");
  check("Only known payment methods", badPay.error !== null, JSON.stringify(badPay));
  const loc = await ownerA.client
    .from("branches")
    .update({ latitude: 24.8138, longitude: 67.0299, google_maps_url: "https://maps.app.goo.gl/x", delivery_minutes: 25 })
    .eq("id", restA.branchId)
    .select("id");
  check("Owner can set the branch pin, Maps link and delivery time", !loc.error && loc.data.length === 1, JSON.stringify(loc));
  const bLoc = await ownerB.client.from("branches").update({ latitude: 1, longitude: 1 }).eq("id", restA.branchId).select("id");
  check("Restaurant B cannot move A's branch pin", bLoc.error !== null || bLoc.data.length === 0, JSON.stringify(bLoc));

  const del = await ownerA.client.from("offers").delete().eq("id", offer.data!.id).select("id");
  check("Owner A can delete their offer", !del.error && del.data.length === 1, JSON.stringify(del));
}

/** Phase 8: cart drafts and page views are server-only; anyone can read the public page info. */
async function menuPageSecurityChecks(ownerA: TestUser, ownerB: TestUser, kitchenA: TestUser, restA: Rest) {
  section("Menu page: public info, server-only drafts and views");
  const anon = createClient<Database>(url!, publishableKey!, noSession);
  const info = await anon.rpc("get_public_menu_info", { p_slug: restA.slug });
  const infoData = info.data as { restaurant?: { id: string }; branch_id?: string } | null;
  check("Anyone can read a restaurant's public menu info", !info.error && infoData?.restaurant?.id === restA.id, JSON.stringify(info.error));
  check("Public info picks the default branch", infoData?.branch_id === restA.branchId, JSON.stringify(infoData?.branch_id));
  const unknown = await anon.rpc("get_public_menu_info", { p_slug: `no-such-${RUN}` });
  check("Unknown restaurant → no info", !unknown.error && unknown.data === null, JSON.stringify(unknown));

  const draft = await admin
    .from("cart_drafts")
    .insert({
      code: "R7S9",
      restaurant_id: restA.id,
      branch_id: restA.branchId,
      lines: [{ item_id: crypto.randomUUID(), quantity: 1 }],
      created_ip_hash: "secret-hash",
    })
    .select("id")
    .single();
  check("Server can save a cart draft", !draft.error, JSON.stringify(draft.error));
  const badCode = await admin.from("cart_drafts").insert({ code: "OOOO", restaurant_id: restA.id, branch_id: restA.branchId, lines: [{}] });
  check("Codes never use look-alike letters (O/0/I/1)", badCode.error !== null, JSON.stringify(badCode.error));
  const dupCode = await admin.from("cart_drafts").insert({ code: "R7S9", restaurant_id: restA.id, branch_id: restA.branchId, lines: [{}] });
  check("A code is unique per restaurant", dupCode.error !== null, JSON.stringify(dupCode.error));

  const anonDraft = await anon.from("cart_drafts").select("id");
  check("Anonymous users cannot read cart drafts", anonDraft.error !== null || anonDraft.data.length === 0, JSON.stringify(anonDraft));
  const anonIns = await anon.from("cart_drafts").insert({ code: "X2X2", restaurant_id: restA.id, branch_id: restA.branchId, lines: [{}] });
  check("Anonymous users cannot create cart drafts (only the API can)", anonIns.error !== null, JSON.stringify(anonIns));
  const ownIns = await ownerA.client.from("cart_drafts").insert({ code: "X3X3", restaurant_id: restA.id, branch_id: restA.branchId, lines: [{}] });
  check("Even owners cannot write cart drafts", ownIns.error !== null, JSON.stringify(ownIns));
  const ownRead = await ownerA.client.from("cart_drafts").select("id, used_at").eq("restaurant_id", restA.id);
  check("Owner A can read their draft stats", !ownRead.error && ownRead.data.length === 1, JSON.stringify(ownRead));
  const ownLines = await ownerA.client.from("cart_drafts").select("lines, created_ip_hash");
  check("Nobody reads draft lines or IP hashes from the browser", ownLines.error !== null, JSON.stringify(ownLines.data));
  const bRead = await ownerB.client.from("cart_drafts").select("id").eq("restaurant_id", restA.id);
  check("Restaurant B cannot read A's cart drafts", !bRead.error && bRead.data.length === 0, JSON.stringify(bRead));
  const kRead = await kitchenA.client.from("cart_drafts").select("id");
  check("Kitchen cannot read cart drafts", (kRead.data?.length ?? 0) === 0, JSON.stringify(kRead));

  const anonView = await anon.rpc("record_menu_page_view", { p_restaurant_id: restA.id, p_branch_id: restA.branchId });
  check("Anonymous users cannot count views directly (only the API can)", anonView.error !== null, JSON.stringify(anonView));
  const v1 = await admin.rpc("record_menu_page_view", { p_restaurant_id: restA.id, p_branch_id: restA.branchId });
  await admin.rpc("record_menu_page_view", { p_restaurant_id: restA.id, p_branch_id: restA.branchId });
  const views = await ownerA.client.from("menu_page_views").select("views").eq("restaurant_id", restA.id);
  check("Server counts page views per day; owner reads them", !v1.error && views.data?.[0]?.views === 2, JSON.stringify({ v1: v1.error, views }));
  const bViews = await ownerB.client.from("menu_page_views").select("views").eq("restaurant_id", restA.id);
  check("Restaurant B cannot read A's page views", !bViews.error && bViews.data.length === 0, JSON.stringify(bViews));
  const ownViewIns = await ownerA.client.from("menu_page_views").insert({ restaurant_id: restA.id, branch_id: restA.branchId, day: "2026-01-01", views: 999 });
  check("Nobody fakes page views from the browser", ownViewIns.error !== null, JSON.stringify(ownViewIns));
  const pending = await ownerA.client.from("bot_sessions").update({ pending_cart_code: "R7S9" }).eq("restaurant_id", restA.id).select("id");
  check("Nobody sets a session's pending cart code from the browser", pending.error !== null || pending.data.length === 0, JSON.stringify(pending));
}

/**
 * Phase 8 integration (REAL database, pricing engine and order engine):
 * the page's draft API → code in a chat → cart loaded → summary → Confirm →
 * exactly one order. Plus expired codes, stock changes and the rate limit.
 */
async function menuPageFlowCheck() {
  section("Menu page: draft API → WhatsApp code → one order");
  const t = await createBotTestRestaurant(admin, { url: url!, publishableKey: publishableKey! }, "mp");
  createdRestaurantIds.push(t.restaurantId);
  createdUserIds.push(t.ownerId);
  try {
    await admin.from("whatsapp_accounts").insert({
      restaurant_id: t.restaurantId,
      branch_id: t.openBranchId,
      phone_number_id: `7${Date.now()}`.slice(0, 15),
      waba_id: "1234567890",
      display_phone_number: "+92 300 7654321",
      access_token_encrypted: encryptToken("fake"),
    });
    const { data: rest } = await admin.from("restaurants").select("slug").eq("id", t.restaurantId).single();
    const slug = rest!.slug;
    const menu = await getBranchMenu(admin, t.restaurantId, t.openBranchId);
    const pizza = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Chicken Tikka Pizza")!;
    const large = pizza.sizes.find((s) => s.name === "Large")!.id;
    const cheese = pizza.groups[0].options.find((o) => o.name === "Extra Cheese")!.id;
    const base = { slug, branchId: t.openBranchId, language: "en" as const };

    const bad = await createCartDraft(admin, { ...base, orderType: "delivery", lines: [{ itemId: t.itemIds["Loaded Fries"], optionIds: [], removals: [], quantity: 1, notes: "" }, { itemId: t.itemIds["Zinger Burger"], optionIds: [], removals: [], quantity: 1, notes: "" }] }, { ipHash: null });
    check("Out-of-stock line → the API says which line", !bad.ok && bad.error === "INVALID_LINES" && bad.problems?.[0]?.index === 0 && bad.problems[0].code === "ITEM_OUT_OF_STOCK", JSON.stringify(bad));
    const noSize = await createCartDraft(admin, { ...base, lines: [{ itemId: pizza.id, optionIds: [], removals: [], quantity: 1, notes: "" }] }, { ipHash: null });
    check("A missing required size is rejected", !noSize.ok && noSize.problems?.[0]?.code === "SIZE_REQUIRED", JSON.stringify(noSize));
    const closed = await createCartDraft(admin, { ...base, branchId: t.closedBranchId, lines: [{ itemId: t.itemIds["Raita"], optionIds: [], removals: [], quantity: 1, notes: "" }] }, { ipHash: null });
    check("A closed branch can't receive carts", !closed.ok && (closed.error === "CLOSED" || closed.error === "NOT_FOUND"), JSON.stringify(closed));
    const missing = await createCartDraft(admin, { ...base, slug: `no-such-${RUN}`, lines: [{ itemId: t.itemIds["Raita"], optionIds: [], removals: [], quantity: 1, notes: "" }] }, { ipHash: null });
    check("Unknown restaurant → NOT_FOUND", !missing.ok && missing.error === "NOT_FOUND", JSON.stringify(missing));

    const ok = await createCartDraft(
      admin,
      {
        ...base,
        orderType: "pickup",
        lines: [
          { itemId: t.itemIds["Zinger Burger"], optionIds: [], removals: [], quantity: 2, notes: "" },
          { itemId: pizza.id, variantId: large, optionIds: [cheese], removals: ["Onion"], quantity: 1, notes: "well done" },
        ],
      },
      { ipHash: `ip-${RUN}` },
    );
    check("Draft saved with a readable code and engine prices (1,100 + 2,000)", ok.ok && /^[A-HJ-NP-Z2-9]{4,5}$/.test(ok.code) && ok.subtotal === 310000, JSON.stringify(ok));
    if (!ok.ok) return;

    // Rate limit: 20 drafts an hour per IP.
    await admin.from("cart_drafts").insert(
      Array.from({ length: 19 }, (_, i) => ({
        code: `Z${"ABC"[Math.floor(i / 8)]}${(i % 8) + 2}K`,
        restaurant_id: t.restaurantId,
        branch_id: t.openBranchId,
        lines: [{}],
        created_ip_hash: `ip-${RUN}`,
      })),
    );
    const { count: sameIp } = await admin.from("cart_drafts").select("id", { count: "exact", head: true }).eq("created_ip_hash", `ip-${RUN}`);
    check("(setup) 20 carts from one IP this hour", sameIp === 20, String(sameIp));
    const limited = await createCartDraft(admin, { ...base, lines: [{ itemId: t.itemIds["Raita"], optionIds: [], removals: [], quantity: 1, notes: "" }] }, { ipHash: `ip-${RUN}` });
    check("Rate limit: the 21st cart in an hour from one IP is refused", !limited.ok && limited.error === "RATE_LIMITED", JSON.stringify(limited));

    // The chat: code → cart loaded by code → (fake model) name + cash → summary → Confirm.
    const store = createSupabaseBotStore(admin);
    const customerId = await t.newCustomer({ name: null });
    let turnNo = 0;
    let step = 0;
    const turns: { tools?: { name: string; input: unknown }[]; text?: string }[][] = [
      [{ text: "Payment cash ya card?" }],
      [{ tools: [{ name: "set_payment_method", input: { payment_method: "cod" } }, { name: "set_customer_name", input: { name: "Sana" } }] }, { tools: [{ name: "show_order_summary", input: {} }] }, { text: "" }],
    ];
    const model = new MockLanguageModelV4({
      modelId: "scripted",
      doGenerate: async () => {
        const s = turns[turnNo][Math.min(step++, turns[turnNo].length - 1)];
        return {
          content: [
            ...(s.tools ?? []).map((x, i) => ({ type: "tool-call" as const, toolCallId: `mp${turnNo}-${step}-${i}`, toolName: x.name, input: JSON.stringify(x.input) })),
            ...(s.text !== undefined ? [{ type: "text" as const, text: s.text }] : []),
          ],
          finishReason: { unified: s.tools?.length ? ("tool-calls" as const) : ("stop" as const), raw: undefined },
          usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
          warnings: [],
        };
      },
    });
    const deps = { store, provider: "google" as const, model: { model, modelId: "scripted" } };
    const chat = { restaurantId: t.restaurantId, branchId: t.openBranchId, customerId };
    const r1 = await runBotTurn({ ...chat, sessionId: null, customerMessages: [`Hi! Mera order code: ${ok.code.toLowerCase()} 🛒\n2x Zinger Burger\n1x Large Chicken Tikka Pizza\n(Pickup)`] }, deps);
    check(
      "Code → cart loaded with engine prices and the order type",
      r1.session.cart.length === 2 && r1.session.cart.reduce((n, l) => n + l.lineTotal, 0) === 310000 && r1.session.orderType === "pickup",
      JSON.stringify(r1.session.cart.map((l) => [l.name, l.lineTotal])),
    );
    check("Reply lists the loaded items, then the bot's question", (r1.replyText ?? "").startsWith("🛒 Aap ka order mil gaya: 2x Zinger Burger, 1x Chicken Tikka Pizza (Large).\n\nPayment"), r1.replyText ?? "");
    turnNo = 1;
    step = 0;
    const r2 = await runBotTurn({ ...chat, sessionId: r1.sessionId, customerMessages: ["cash, naam Sana"] }, deps);
    check("Then the normal flow: summary with Confirm", r2.session.status === "awaiting_confirmation" && (r2.replyText ?? "").includes("Rs 3,100"), r2.replyText ?? "");
    await runBotTurn({ ...chat, sessionId: r1.sessionId, customerMessages: ["Confirm"], buttonId: "confirm" }, deps);
    const { data: orders } = await admin.from("orders").select("id, total, order_type, source, status").eq("customer_id", customerId);
    check("Exactly one order, total 3,100, pickup, waiting for acceptance", orders?.length === 1 && orders[0].total === 310000 && orders[0].order_type === "pickup" && orders[0].status === "awaiting_acceptance", JSON.stringify(orders));
    const { data: d1 } = await admin.from("cart_drafts").select("used_at, used_by_customer_id, session_id").eq("restaurant_id", t.restaurantId).eq("code", ok.code).single();
    check("Draft marked used by this customer and session", !!d1?.used_at && d1.used_by_customer_id === customerId && d1.session_id === r1.sessionId, JSON.stringify(d1));
    const { data: sess } = await admin.from("bot_sessions").select("cart_draft_id, order_id").eq("id", r1.sessionId).single();
    check("Session links the draft and the order (conversion stats)", !!sess?.cart_draft_id && !!sess.order_id, JSON.stringify(sess));

    // Same code again → expired message (single use), no second order.
    const again = await runBotTurn({ ...chat, sessionId: null, customerMessages: [`Hi! Mera order code: ${ok.code}`] }, deps);
    check("A code works only once", (again.replyText ?? "").startsWith("Ye order code expire ho gaya hai"), again.replyText ?? "");

    // Expired (older than 2 hours).
    const old = await createCartDraft(admin, { ...base, lines: [{ itemId: t.itemIds["Raita"], optionIds: [], removals: [], quantity: 1, notes: "" }] }, { ipHash: null, now: new Date(Date.now() - 3 * 3600_000) });
    const c2 = await t.newCustomer({ name: "Ali" });
    const expired = old.ok ? await runBotTurn({ ...chat, customerId: c2, sessionId: null, customerMessages: [`Hi! Mera order code: ${old.code}`] }, deps) : null;
    check("An expired code gets the 'expired' reply with the menu link", !!expired && (expired.replyText ?? "").includes("expire") && (expired.replyText ?? "").includes(`/m/${slug}`), expired?.replyText ?? JSON.stringify(old));

    // Stock changes between the draft and the chat → that line is skipped.
    const fresh = await createCartDraft(admin, { ...base, lines: [{ itemId: t.itemIds["Zinger Burger"], optionIds: [], removals: [], quantity: 1, notes: "" }, { itemId: t.itemIds["Garlic Naan"], optionIds: [], removals: [], quantity: 2, notes: "" }] }, { ipHash: null });
    await admin.from("branch_item_settings").upsert({ restaurant_id: t.restaurantId, branch_id: t.openBranchId, item_id: t.itemIds["Garlic Naan"], is_available: false });
    const c3 = await t.newCustomer({ name: "Bilal" });
    turnNo = 0;
    step = 0;
    const r3 = fresh.ok ? await runBotTurn({ ...chat, customerId: c3, sessionId: null, customerMessages: [`Hi! Mera order code: ${fresh.code}`] }, deps) : null;
    check(
      "Item out of stock since the draft → skipped and named",
      !!r3 && r3.session.cart.map((l) => l.name).join() === "Zinger Burger" && (r3.replyText ?? "").includes("2x Garlic Naan abhi available nahi"),
      r3?.replyText ?? JSON.stringify(fresh),
    );
  } catch (err) {
    check("Menu page flow ran", false, err instanceof Error ? err.stack ?? err.message : String(err));
  }
}

/**
 * A full scripted conversation (fake model, REAL database, pricing and order
 * engine) creates exactly one correct order.
 */
async function botConversationCheck() {
  section("Bot: scripted conversation creates exactly one correct order");
  const t = await createBotTestRestaurant(admin, { url: url!, publishableKey: publishableKey! }, "rls");
  createdRestaurantIds.push(t.restaurantId);
  createdUserIds.push(t.ownerId);
  try {
    const store = createSupabaseBotStore(admin);
    const idx = buildMenuIndex(await store.getMenu(t.restaurantId, t.openBranchId));
    const ref = (name: string) => idx.itemRef.get(t.itemIds[name])!;
    const customerId = await t.newCustomer({ name: null });

    type Step = { tools?: { name: string; input: unknown }[]; text?: string };
    const turns: Step[][] = [
      [
        {
          tools: [
            { name: "add_to_cart", input: { item_id: ref("Chicken Tikka Pizza"), variant_id: "Large", option_ids: ["Extra Cheese"], removals: ["Onion"] } },
            { name: "add_to_cart", input: { item_id: ref("Zinger Burger"), quantity: 2 } },
          ],
        },
        { text: "Pizza aur 2 Zinger add kar diye. Delivery ya pickup?" },
      ],
      [
        {
          tools: [
            { name: "set_delivery_address", input: { address_text: "House 7, Street 2", area: "Clifton", landmark: "near Dolmen Mall" } },
            { name: "set_payment_method", input: { payment_method: "cod" } },
            { name: "set_customer_name", input: { name: "Sana" } },
          ],
        },
        { tools: [{ name: "show_order_summary", input: {} }] },
        { text: "" },
      ],
    ];
    let turn = 0;
    let step = 0;
    const model = new MockLanguageModelV4({
      modelId: "scripted",
      doGenerate: async () => {
        const s = turns[turn][Math.min(step++, turns[turn].length - 1)];
        return {
          content: [
            ...(s.tools ?? []).map((x, i) => ({ type: "tool-call" as const, toolCallId: `t${turn}-${step}-${i}`, toolName: x.name, input: JSON.stringify(x.input) })),
            ...(s.text !== undefined ? [{ type: "text" as const, text: s.text }] : []),
          ],
          finishReason: { unified: s.tools?.length ? ("tool-calls" as const) : ("stop" as const), raw: undefined },
          usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
          warnings: [],
        };
      },
    });
    const deps = { store, provider: "google" as const, model: { model, modelId: "scripted" } };
    const base = { restaurantId: t.restaurantId, branchId: t.openBranchId, customerId };

    const r1 = await runBotTurn({ ...base, sessionId: null, customerMessages: ["ek large tikka pizza extra cheese onion nahi", "aur 2 zinger"] }, deps);
    turn = 1;
    step = 0;
    const r2 = await runBotTurn(
      { ...base, sessionId: r1.sessionId, customerMessages: ["delivery, House 7 Street 2 Clifton near Dolmen Mall, cash, naam Sana"] },
      deps,
    );
    check(
      "Summary is shown with Confirm/Change/Cancel",
      r2.session.status === "awaiting_confirmation" && r2.showButtons?.[0]?.id === "confirm",
      JSON.stringify(r2.replyText),
    );
    check("Summary total comes from the pricing engine (2,000 + 1,100 + 150 delivery)", (r2.replyText ?? "").includes("Rs 3,250"), r2.replyText ?? "");

    const r3 = await runBotTurn({ ...base, sessionId: r1.sessionId, customerMessages: ["Confirm"], buttonId: "confirm" }, deps);
    // A double tap on Confirm must not create a second order.
    await runBotTurn({ ...base, sessionId: r1.sessionId, customerMessages: ["Confirm"], buttonId: "confirm" }, deps);

    const { data: orders } = await admin
      .from("orders")
      .select(
        "id, order_number, status, source, order_type, payment_method, subtotal, delivery_fee, total, customer_name, risk_flag, items:order_items(item_name, size_name, quantity, unit_price, line_total, removals, modifiers:order_item_modifiers(option_name))",
      )
      .eq("customer_id", customerId);
    check("Exactly one order is created", orders?.length === 1, JSON.stringify(orders?.length));
    const o = orders?.[0];
    check(
      "It is a WhatsApp delivery order waiting for acceptance",
      o?.status === "awaiting_acceptance" && o.source === "whatsapp" && o.order_type === "delivery" && o.payment_method === "cod",
      JSON.stringify(o),
    );
    check("Totals are correct (subtotal 3,100 + delivery 150 = 3,250)", o?.subtotal === 310000 && o.delivery_fee === 15000 && o.total === 325000, JSON.stringify(o));
    const pizza = o?.items.find((i) => i.item_name === "Chicken Tikka Pizza");
    check(
      "Pizza line keeps size, extra and removal",
      pizza?.size_name === "Large" &&
        pizza.unit_price === 200000 &&
        pizza.removals.includes("Onion") &&
        pizza.modifiers.some((m) => m.option_name === "Extra Cheese"),
      JSON.stringify(pizza),
    );
    check("Customer name was saved and used", o?.customer_name === "Sana", JSON.stringify(o?.customer_name));
    check(
      "Reply has the order number",
      r3.orderCreated?.orderNumber === o?.order_number && (r3.replyText ?? "").includes(`#${o?.order_number}`),
      r3.replyText ?? "",
    );
    check("No risk flag below the high-value limit", !o?.risk_flag, String(o?.risk_flag));
    const { count } = await admin.from("ai_logs").select("id", { count: "exact", head: true }).eq("restaurant_id", t.restaurantId);
    check("Every AI turn is logged", (count ?? 0) === 2, String(count));
  } catch (err) {
    check("Scripted bot conversation ran", false, err instanceof Error ? err.stack ?? err.message : String(err));
  }
}
