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
| `order_status` | pending_confirmation, awaiting_acceptance, accepted, preparing, ready, out_for_delivery, delivered, completed, cancelled, failed | 4 ✅ |
| `order_type` | delivery, pickup, dine_in | 4 ✅ |
| `order_source` | whatsapp, phone, walk_in, web | 4 ✅ |
| `payment_method` | cod, card_on_delivery, bank_transfer, online_link | 4 ✅ |
| `payment_status` | unpaid, pending_verification, paid, refunded, partially_refunded | 4 ✅ |
| `order_event_type` | created, status_changed, edited, held, unheld, cancelled, payment_updated, note_added, printed | 4 ✅ |
| `actor_type` | staff, customer, bot, system | 4 ✅ |
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

## Phase 4 — Customers & orders ✅ (built)

**Golden rule: no client ever writes orders.** `authenticated` has SELECT only on order tables. All writes go through service-role-only RPCs, called by the order engine (`src/lib/orders/engine.ts`) after a permission + branch check, with every price from the pricing engine. A CHECK constraint enforces `total = subtotal + delivery_fee + tax + service_charge − discount`.

### `customers`
id, restaurant_id, phone (**E.164**, unique per restaurant), name, whatsapp_id, notes, tags text[], is_blocked, blocked_reason, total_orders, total_spent (bigint paisa), cancelled_count (fake-order cancels), refused_count (refused deliveries), last_order_at, marketing_opt_in, timestamps.
Created/found by phone inside `create_order`. Users may update only name/notes/tags/marketing_opt_in; stats and blocking are server-only.

### `customer_addresses`
id, restaurant_id, customer_id, label, address_text, area, landmark, latitude, longitude, is_default, created_at. Saved from delivery orders (deduplicated by text).

### `order_counters`
restaurant_id PK, last_number. Atomic upsert in `create_order` → #1001, #1002… per restaurant.

### `orders`
id, restaurant_id, branch_id, order_number, customer_id (null for walk-ins), customer_name/customer_phone (snapshots), order_type, source, status, is_on_hold, hold_reason, payment_method, payment_status, subtotal, delivery_fee, discount, tax, service_charge, total, address snapshot (address_text, area, landmark, latitude, longitude), table_number, notes, scheduled_for, expected_ready_at, accepted_at, preparing_at, ready_at, dispatched_at, delivered_at, completed_at, cancelled_at, failed_at, cancel_reason, cancel_note, cancelled_by, rider_id (no FK until Phase 9), **version** (optimistic locking), idempotency_key (unique per restaurant), created_by, timestamps.
Index (restaurant_id, branch_id, status, created_at). In the `supabase_realtime` publication.

### `order_items`
id, restaurant_id, order_id, item_id, variant_id (plain ids), item_name, size_name, quantity, unit_price, line_total (CHECK = unit × qty), removals, notes, **snapshot jsonb** (`CartItemSnapshot` from the pricing engine), is_cancelled (true = replaced by an edit), created_at.

### `order_item_modifiers`
id, restaurant_id, order_item_id, option_id, group_name, option_name, price_delta (snapshots).

### `order_events` (timeline, insert-only)
id, restaurant_id, order_id, event_type, from_status, to_status, actor_type, actor_user_id, data jsonb, created_at. In the realtime publication. **Never store phone/address in `data`** — kitchen can read events.

### `payments`
id, restaurant_id, order_id, method, amount (= order total, from the DB), status, reference, verified_by, verified_at, created_at. Only via `record_payment` — never automatic.

### Branch order settings (columns on `branches`)
accept_alert_minutes (3), default_prep_minutes (20), auto_accept_orders (false, for bot orders later), late_order_minutes (30), staff_orders_need_acceptance (false → staff orders start "accepted").

### RLS
| Table | Who reads |
| --- | --- |
| orders, payments | owner/manager/staff with access to the order's branch |
| order_items, order_item_modifiers, order_events | the above **plus kitchen** |
| customers, customer_addresses | owner/manager/staff (restaurant-wide) |
| `kitchen_orders` view | owner/manager/staff/kitchen with branch access — **no phone, address or money columns** |
| order_counters | nobody (server only) |

### RPCs (service role only)
| Function | Does |
| --- | --- |
| `create_order(p)` | idempotency (advisory lock + unique key), customer find/create, address save, number, order + items + modifiers + `created` event — one transaction |
| `transition_order_status(...)` | row lock, version check, state machine + role rules (mirrors `src/lib/orders/status.ts`), timestamps, event, customer stats, `order.cancelled` audit |
| `edit_order(p)` | version check, old items → is_cancelled, new priced items, totals, `edited` event (before/after, kitchen_alert), `order.edited` audit |
| `set_order_hold(...)` | hold/unhold with reason, event |
| `record_payment(...)` | payments row + payment_status = paid + event |

State machine: pending_confirmation → awaiting_acceptance | cancelled; awaiting_acceptance → accepted | cancelled; accepted → preparing | cancelled; preparing → ready | cancelled (manager+); ready → out_for_delivery (delivery) | completed (pickup/dine-in) | cancelled (manager+); out_for_delivery → delivered | failed; delivered → completed. Kitchen may only do accepted→preparing and preparing→ready. Held orders can only be cancelled.

---

## Phase 5 — Riders & delivery zones

### `delivery_zones`
id, restaurant_id, branch_id, name ("DHA Phase 5"), fee_paisa, min_order_paisa, estimated_minutes, polygon jsonb (optional) / areas text[], is_active.

### `rider_shifts` (optional)
id, restaurant_id, branch_id, rider_id, started_at, ended_at, cash_collected_paisa.

Riders themselves are `memberships` with role `rider`. Rider page `/rider` shows only orders where `rider_id = auth.uid()`.

---

## Phase 6 — WhatsApp

6A ✅ (connection, receiving, temporary greeting, read-only inbox). Migration `20261112100000_whatsapp.sql`.
6B ✅ (order status messages, QR code, media storage, send helpers for the bot). Migration `20261113100000_whatsapp_6b.sql`.
No WhatsApp templates: every outbound message only inside the 24-hour customer window; outside it the message is saved as `skipped` and not sent.
Enums: `wa_direction` (inbound, outbound), `wa_message_type` (text, image, audio, document, location, interactive, button, unknown), `wa_message_status` (received, sent, delivered, read, failed, skipped), `wa_conversation_status` (open, resolved).

### `whatsapp_accounts` ✅
id, restaurant_id (**unique** — one number per restaurant for now), branch_id (default branch for incoming orders; null = first branch), phone_number_id (**unique**, Meta), waba_id, display_phone_number, access_token_encrypted (AES-256-GCM with `TOKEN_ENCRYPTION_KEY`, format `v1:iv:tag:data`), is_active, connected_at, timestamps.
Written only by super admin server actions (admin client). Owners/managers can SELECT every column **except** `access_token_encrypted` (column-level grant), so the token never reaches a browser. (Replaces the earlier Vault plan.)

### `whatsapp_conversations` ✅
id, restaurant_id, customer_id, wa_id (customer's WhatsApp number, digits), last_customer_message_at (24-hour window), last_message_at, last_message_preview, last_auto_reply_at (greeting cooldown), status (open/resolved), bot_enabled (default true), timestamps. Unique (restaurant_id, wa_id).
Front of house reads; no browser writes yet (Phase 10 adds takeover: mode, assigned_to, unread_count, draft_order).

### `whatsapp_messages` ✅
id, restaurant_id, conversation_id, wa_message_id (**unique**, webhook idempotency; null for skipped/failed outbound), direction, type, body, media_id (Meta), media_url (inbound: our Storage path `{restaurant_id}/{message_id}.{ext}`; outbound: the https link we sent), media_mime_type, media_size, order_id (order status messages; composite FK to orders, `on delete set null (order_id)`), raw jsonb, status, error, created_at, updated_at.
Front of house reads; only the server writes. Statuses only move forward (sent → delivered → read; failed).

### `restaurants.whatsapp_status_messages` ✅ (6B)
jsonb, default all on: `{accepted, preparing, ready, out_for_delivery, delivered, cancelled}` → true/false. Owner updates (column grant + restaurant RLS).

### Storage: `whatsapp-media` bucket ✅ (6B)
Private, 16 MB limit. Path `{restaurant_id}/{message_id}.{ext}`. Only the service role uploads. Owner/manager/staff of that restaurant (and super admin) can read → the inbox creates 1-hour signed URLs with the user's client. Kitchen and other restaurants can't.

### `whatsapp_webhook_events` ✅
id, raw jsonb, received_at, processed_at, error. Platform level (no restaurant_id: unknown until parsed). Super admin reads. Saved after the signature check, before processing.

RPCs (service role only): `whatsapp_record_inbound(...)` — customer + conversation + message in one transaction, advisory lock per wa_message_id, returns `duplicate`; `whatsapp_claim_auto_reply(conversation_id, cooldown)` — true for exactly one caller per cooldown.

Webhooks use the admin client (no user session) and must always scope writes by the `restaurant_id` resolved from the receiving phone number.

---

## Phase 7 — Payments (records only, no gateways in MVP)

### `payments`
Built in Phase 4 (see above). Later: add proof_url (transfer screenshot) and gateway fields.

### `refunds`
id, restaurant_id, order_id, payment_id, amount_paisa, reason, created_by, created_at. Always writes `audit_logs` (`order.refunded`).

---

## Phase 8 — Reports
No new tables at first: SQL views / RPCs over `orders` and `order_items` (daily sales, top items, busy hours), filtered by `restaurant_id` and branch access. Add materialized daily rollups only if needed for speed.

## Out of MVP scope (leave room, don't build)
Inventory, recipe costing, accounting, payroll, loyalty points, marketing campaigns, foodpanda integration, online payment gateways.
