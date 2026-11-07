# Orderly — Database schema plan (MVP)

This is the **plan for the whole MVP database**. Each phase creates only its
own tables, through SQL migrations in `supabase/migrations`. When a phase
builds something here, follow this document. If the plan has to change,
update this file in the same change.

## Conventions (all tables)

| Rule | Detail |
| --- | --- |
| Primary keys | `id uuid default gen_random_uuid()` (audit logs use a `bigint` identity) |
| Tenancy | Every business table has `restaurant_id uuid not null` → `restaurants(id)` |
| Branch scope | Tables that belong to one branch also have `branch_id` → `branches(id)`, with a composite FK `(branch_id, restaurant_id)` → `branches(id, restaurant_id)` so a row can never point at another restaurant's branch |
| Money | `integer`/`bigint` **paisa**. Never `numeric`/`float`. Column names end in `_paisa` |
| Timestamps | `created_at timestamptz default now()`, `updated_at` maintained by `private.set_updated_at()` trigger |
| RLS | Enabled on every table, with policies, before the table is used. Helpers live in the `private` schema (not exposed to the API) |
| Grants | `anon` gets nothing unless the table is deliberately public. `authenticated` gets column-level `insert`/`update` grants so protected columns (e.g. `is_super_admin`, `status`, prices computed by the backend) cannot be written from the browser |
| Indexes | Every `restaurant_id`, `user_id`, `branch_id` and other FK column is indexed |
| Deletes | Business data is soft-deleted (`is_active` / `deleted_at`) — the API never hard-deletes |
| Audit | Order edits, cancellations, refunds, price changes, staff and restaurant changes write to `audit_logs` |

## Access helpers (`private` schema, SECURITY DEFINER, `search_path = ''`)

| Function | True when |
| --- | --- |
| `private.is_super_admin()` | Current user's profile has `is_super_admin` |
| `private.is_member(restaurant_id)` | Current user has an active membership in the restaurant |
| `private.has_role(restaurant_id, roles member_role[])` | …and their role is one of `roles` |
| `private.has_restaurant_wide_access(restaurant_id)` | …and the membership has `branch_id is null` (all branches) |
| `private.can_access_branch(branch_id)` | User has a restaurant-wide membership or one for that exact branch |
| `private.shares_restaurant(user_id)` | Current user and `user_id` belong to a common restaurant |

## Enums

| Enum | Values | Phase |
| --- | --- | --- |
| `member_role` | owner, manager, staff, kitchen, rider | 2 |
| `restaurant_status` | trial, active, suspended | 2 |
| `order_status` | awaiting, accepted, preparing, ready, out_for_delivery, delivered, cancelled | 4 |
| `order_type` | delivery, pickup | 4 |
| `order_source` | whatsapp, phone, walk_in, web | 4 |
| `payment_method` | cod, bank_transfer (later: jazzcash, easypaisa, card) | 4 |
| `payment_status` | unpaid, pending_verification, paid, refunded, partially_refunded | 4 |
| `conversation_mode` | bot, staff | 6 |
| `message_direction` | inbound, outbound | 6 |

---

## Phase 2 — Tenancy, auth, roles ✅ (built)

### `profiles`
One row per auth user, created by a trigger on `auth.users`.

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | → `auth.users(id)` on delete cascade |
| full_name, phone, avatar_url | text | user-editable |
| is_super_admin | boolean | **not writable** via API (no column grant) |
| must_change_password | boolean | set by server when staff get a temporary password; cleared by the server after a password change |
| created_at, updated_at | timestamptz | |

RLS: read own, read people in the same restaurant, super admin reads all; update own (only `full_name`, `phone`, `avatar_url`).

### `restaurants`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| name | text | 2–80 chars |
| slug | text unique | `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`, reserved words blocked; used in `/m/[slug]`. Not editable after creation |
| logo_url, phone, whatsapp_number, city | text | |
| timezone | text | default `Asia/Karachi` |
| currency | text | default `PKR` |
| status | restaurant_status | default `trial`; only server/super admin changes it |
| trial_ends_at | timestamptz | creation + 14 days |
| created_by | uuid | → `auth.users`, on delete set null |

Created **only** by RPC `create_restaurant_with_owner(...)` (restaurant + first branch + owner membership + audit row in one transaction). No insert/delete grants.
RLS: members read; owner updates name/logo/phone/whatsapp/city; super admin reads all.

### `branches`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | unique `(id, restaurant_id)` for composite FKs |
| restaurant_id | uuid | → restaurants, cascade |
| name, address, area, city, phone | text | |
| is_open | boolean | live "taking orders" switch (top bar) |
| opening_hours | jsonb | see format below; validated by `private.is_valid_opening_hours` |
| latitude, longitude | double precision | for delivery zones later |
| is_active | boolean | soft delete |

`opening_hours` format — all 7 keys required; `close` earlier than `open` means closing after midnight:
```json
{ "mon": { "closed": false, "open": "12:00", "close": "02:00" },
  "tue": { "closed": true }, "wed": {...}, "thu": {...}, "fri": {...}, "sat": {...}, "sun": {...} }
```
RLS: read if `can_access_branch`; owner/manager with restaurant-wide access insert; owner/manager who can access the branch update.

### `memberships`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid | → `profiles(id)` cascade (lets PostgREST embed profiles) |
| restaurant_id | uuid | → restaurants cascade |
| branch_id | uuid null | null = all branches. Composite FK to `branches(id, restaurant_id)`, on delete set null |
| role | member_role | owners must have `branch_id is null` |
| is_active | boolean | deactivate instead of delete |
| unique | `(user_id, restaurant_id)` | one role per person per restaurant |

RLS: read own; owner/manager read all in restaurant; owner inserts/updates others (never role `owner`, never their own row). No deletes.

### `audit_logs`
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint identity PK | |
| restaurant_id | uuid | |
| user_id | uuid | defaults to `auth.uid()`; must equal it on insert |
| action | text | `entity.verb`, e.g. `staff.added`, `order.cancelled`, `menu_item.price_changed` |
| entity_type, entity_id | text | |
| old_data, new_data | jsonb | |
| created_at | timestamptz | |

RLS: owner/manager read; members insert own rows; **no update/delete for anyone via API**.

### Storage: `restaurant-logos` bucket
Public read. Path `{restaurant_id}/logo-{timestamp}.{ext}`. Only owners of that restaurant can upload/replace/delete. 1 MB, png/jpeg/webp.

---

## Phase 3 — Menu ✅ (built)

UI words → table names: **Sizes** = `item_variants`, **Extras / Choices** = `modifier_groups` + `modifier_options`, **Other names customers use** = `menu_items.aliases`, **Can be removed** = `menu_items.removable_options`.

All menu tables use composite FKs `(parent_id, restaurant_id)` → `parent(id, restaurant_id)`, so no row can reference another restaurant's data. Prices are integer paisa (`0 … 100,000,000`).
**Nothing is hard-deleted** (no DELETE grant): items, sizes, groups, options and categories get `archived_at`. Archived rows are hidden everywhere except reports/past orders.

### `menu_categories`
id, restaurant_id, name, name_ur, description, sort_order, is_active, archived_at, timestamps.

### `menu_items`
id, restaurant_id, category_id, name, name_ur, description, description_ur, image_url, **base_price** (nullable: only for items without sizes), is_active (shown on menu), sort_order, tags text[] (bestseller, spicy, new, vegetarian, deal, popular), prep_time_minutes, aliases text[] (≤30), removable_options text[] (≤30), archived_at, timestamps.

### `item_variants` ("Sizes")
id, restaurant_id, item_id, name, name_ur, **price** (full price for the size), is_default (max one live default per item), sort_order, is_active, archived_at, timestamps.
*Differs from plan:* has `archived_at` (soft delete).

### `modifier_groups` ("Extras / Choices", reusable across items)
id, restaurant_id, name, name_ur, min_select (0 = optional), max_select (≥1, ≥ min), sort_order, archived_at, timestamps.

### `modifier_options`
id, restaurant_id, group_id, name, name_ur, price_delta (≥ 0), is_default, is_available, sort_order, archived_at, timestamps.
*Differs from plan:* has `archived_at`.

### `item_modifier_groups`
PK (item_id, group_id), restaurant_id, sort_order. The only menu table rows can be deleted from (detaching a group).

### `branch_item_settings`
PK (branch_id, item_id), restaurant_id, is_available (in stock), is_hidden (not sold here), price_override (items without sizes), updated_at.

### `branch_variant_prices`
PK (branch_id, variant_id), restaurant_id, price, updated_at.

**RLS:** members read (branch tables: members who can access the branch); owner/manager write. Stock for staff/kitchen only via `set_item_stock()`.

**RPCs**
| Function | Security | Purpose |
| --- | --- | --- |
| `set_item_stock(branch, item, available)` | definer | owner/manager/staff/kitchen with branch access; changes only `is_available`; writes `menu_item.stock_changed` audit |
| `save_menu_item(restaurant, item jsonb)` | invoker | item + sizes + extras links + branch settings/prices in one transaction; removed sizes archived |
| `save_modifier_group(restaurant, group jsonb)` | invoker | group + options in one transaction; removed options archived |
| `reorder_menu_categories`, `reorder_menu_items` | invoker | drag-and-drop order |
| `apply_price_changes(restaurant, changes, audit)` | invoker | bulk price update + ONE `menu.bulk_price_update` audit entry, atomically |
| `get_public_menu(slug, branch_id)` | definer, **anon** | the only public read path; trial/active restaurants, active branch, active non-archived non-hidden items with branch prices and stock |

**Pricing:** every price is computed by `src/lib/menu/pricing.ts` (`resolveCartItem`, `getBranchMenu`). Effective price = branch size price ?? size price, or branch price_override ?? base_price, plus selected option deltas.

Storage bucket `menu-images`: public read; owner/manager write inside `{restaurant_id}/`. Photos are resized to ≤1200px WebP (~200 KB) in the browser.

---

## Phase 4 — Customers & orders

### `customers`
id, restaurant_id, phone (E.164, unique per restaurant), name, notes, is_blocked, fake_order_count, total_orders, total_spent_paisa, last_order_at, timestamps.

### `customer_addresses`
id, restaurant_id, customer_id, label, address_text, area, landmark, latitude, longitude, is_default.

### `orders`
| Column | Notes |
| --- | --- |
| id, restaurant_id, branch_id | composite FK to branch |
| order_number int | per-restaurant sequence (shown as #1042), unique (restaurant_id, order_number) |
| customer_id, address_id | |
| status order_status, type order_type, source order_source | |
| subtotal_paisa, delivery_fee_paisa, discount_paisa, total_paisa | **computed by backend only** (no column grants) |
| payment_method, payment_status | |
| customer_note, kitchen_note | |
| rider_id | → profiles (membership role rider) |
| confirmed_by_customer_at | must be set before `accepted` (rule: kitchen only after explicit confirmation) |
| accepted_at, ready_at, picked_up_at, delivered_at, cancelled_at, cancel_reason, cancelled_by | |
| idempotency_key | unique — retried submits never double-create |

### `order_items`
id, restaurant_id, order_id, menu_item_id, variant_id, unit_price, quantity, line_total, note, and **`snapshot jsonb`** = the `CartItemSnapshot` returned by `resolveCartItem()` (item/size/option names + prices, removals, unit price, quantity, line total, priced_at). Never re-read menu prices for an existing order.

### `order_status_history`
id, restaurant_id, order_id, from_status, to_status, changed_by, created_at. Written by trigger.

Order creation, edits, status changes and cancellation go through server actions / RPCs that recompute totals from the menu tables. Edits and cancellations write `audit_logs`.
RLS: members with branch access read; staff+ insert/update via RPCs; kitchen reads accepted/preparing; rider reads orders assigned to them.

---

## Phase 5 — Riders & delivery zones

### `delivery_zones`
id, restaurant_id, branch_id, name ("DHA Phase 5"), fee_paisa, min_order_paisa, estimated_minutes, polygon jsonb (optional) / areas text[], is_active.

### `rider_shifts` (optional)
id, restaurant_id, branch_id, rider_id, started_at, ended_at, cash_collected_paisa.

Riders themselves are `memberships` with role `rider`. Rider page `/rider` shows only orders where `rider_id = auth.uid()`.

---

## Phase 6 — WhatsApp

### `whatsapp_accounts`
id, restaurant_id, branch_id (null = all), phone_number_id (Meta), display_phone, waba_id, status, access token **stored in Supabase Vault, never in a table column**.

### `conversations`
id, restaurant_id, branch_id, customer_id, wa_contact_phone, mode conversation_mode (bot/staff), assigned_to, last_message_at, unread_count, draft_order jsonb (AI-parsed cart awaiting confirmation), status (open/closed).

### `messages`
id, restaurant_id, conversation_id, direction, wa_message_id **unique** (webhook idempotency), type (text/image/audio/location/interactive), body, media_url, payload jsonb, sent_by (staff user or null = bot/customer), status (sent/delivered/read/failed), created_at.

### `webhook_events`
id, provider ('whatsapp' | payment), event_id unique, payload jsonb, processed_at, error. Signature verified before insert; duplicates ignored.

Webhooks use the admin client (no user session) and must always scope writes by the `restaurant_id` resolved from the receiving phone number.

---

## Phase 7 — Payments (records only, no gateways in MVP)

### `payments`
id, restaurant_id, order_id, method payment_method, amount_paisa, status, reference (bank transfer ref), proof_url (screenshot), verified_by, verified_at, created_at.

### `refunds`
id, restaurant_id, order_id, payment_id, amount_paisa, reason, created_by, created_at. Always writes `audit_logs` (`order.refunded`).

---

## Phase 8 — Reports
No new tables at first: SQL views / RPCs over `orders` and `order_items` (daily sales, top items, busy hours), filtered by `restaurant_id` and branch access. Add materialized daily rollups only if needed for speed.

## Out of MVP scope (leave room, don't build)
Inventory, recipe costing, accounting, payroll, loyalty points, marketing campaigns, foodpanda integration, online payment gateways.
