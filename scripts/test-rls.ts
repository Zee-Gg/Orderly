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

  await menuChecks(ownerA, ownerB, kitchenA, restA, restB);
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
}

async function cleanup() {
  section("Cleanup");
  if (uploadedPaths.length) await admin.storage.from(LOGO_BUCKET).remove(uploadedPaths);
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
