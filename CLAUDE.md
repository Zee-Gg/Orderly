# Orderly— WhatsApp Ordering SaaS for Pakistani Restaurants

## What this is
A multi-tenant SaaS where restaurants receive food orders through WhatsApp. An AI bot converts customer messages (English, Urdu, Roman Urdu) into structured orders. Staff manage orders, kitchen, menu, riders, and customers from a web dashboard.

Users: restaurant owner, manager, staff (cashier/order taker), kitchen, rider, and the end customer (via WhatsApp + a mobile menu page). Platform super admin = me.

## Stack (do not change without asking)
- Next.js (App Router) + TypeScript (strict mode)
- Tailwind CSS v4 (design tokens in globals.css via @theme)
- Supabase: Postgres, Auth, Storage, Realtime
- @supabase/ssr for server/client Supabase clients
- Database changes ONLY through SQL migrations in /supabase/migrations

## Core rules
1. MULTI-TENANCY: every business table has `restaurant_id`. Row Level Security (RLS) is ON for every table. Access is decided by the `memberships` table (user_id, restaurant_id, branch_id nullable, role). Never rely on the frontend for tenant isolation.
2. NEVER use the Supabase secret key in client components. Only in server code (route handlers, server actions, webhooks).
3. MONEY: store all amounts as integers (paisa). Format to "Rs 1,850" only in the UI. Never use floats for money.
4. PRICES ARE COMPUTED BY THE BACKEND from the database. The AI never calculates prices or totals.
5. An order goes to the kitchen ONLY after the customer explicitly confirms it.
6. Roles: super_admin, owner, manager, staff, kitchen, rider. Check permissions on the server.
7. Validate all inputs with Zod.
8. Webhooks (WhatsApp, payments) must verify signatures and be idempotent.
9. Audit log for: order edits, cancellations, refunds, price changes.

## UI rules
- Follow the designs in /design (screenshots). Match colors, spacing, components.
- Mobile-first. Must work on cheap Android phones and weak internet.
- Big touch targets (min 44px). Simple, plain wording for non-technical users.
- Order status colors: awaiting=amber, accepted=blue, preparing=orange, ready=green, out_for_delivery=purple, delivered=gray, cancelled=red. Always color + icon + text.
- Support Urdu text rendering (Noto Nastaliq Urdu) and RTL where Urdu is shown.
- Reusable components live in src/components/ui. Do not duplicate components.

## Folder structure
- src/app/(auth)        → login, signup, forgot/reset/change password
- src/app/auth          → /auth/callback (email + OAuth links), /auth/continue (post-login router)
- src/app/(dashboard)   → staff dashboard pages (shell: sidebar, top bar, bottom nav)
- src/app/onboarding, src/app/select-restaurant → setup screens (no shell)
- src/app/kitchen       → kitchen display
- src/app/rider         → rider mobile page
- src/app/m/[slug]      → public customer menu page
- src/app/admin         → super admin
- src/app/api           → route handlers + webhooks
- src/components/ui     → shared UI components
- src/components/shell  → app shell (sidebar, top bar, branch switcher, open toggle)
- src/lib               → supabase clients, utils, validation, business logic
- src/lib/auth          → session helpers, permissions matrix, auth actions
- src/types/database.ts → generated Supabase types (`npm run db:types`, never edit by hand)
- supabase/migrations   → SQL migrations
- docs/schema.md        → planned schema for the whole MVP. Follow it; update it when the plan changes
- scripts/test-rls.ts   → RLS isolation test

## Pricing (Phase 3) — ONE source of truth
- ALL prices come from `src/lib/menu/pricing.ts`: `resolveCartItem(db, input)` for one line (validates stock, sizes, extras rules, removals; returns typed error codes + a snapshot), `resolveCart`, and `getBranchMenu(db, restaurantId, branchId)`.
- Never compute a price anywhere else — not in components, not in order code, not in the AI. Never accept a price from the browser or the bot.
- Orders store the `snapshot` from `resolveCartItem`, so menu changes never alter past orders.
- Pass the right client: the user's server client (RLS) for staff; the admin client for webhooks (then always scope by `restaurantId`).
- Pure logic is unit-tested in `pricing.test.ts` (`npm test`). Add a test for every new pricing rule.

## Orders (Phase 4) — the order engine
- ALL order writes go through `src/lib/orders/engine.ts` (`createOrder`, `transitionOrder`, `editOrder`, `setOrderHold`, `recordPayment`). It re-prices every line with the pricing engine and calls service-role-only RPCs (`create_order`, `transition_order_status`, `edit_order`, `set_order_hold`, `record_payment`).
- NEVER insert/update `orders`, `order_items`, `order_item_modifiers`, `payments`, `order_counters` from the client or with a user client — `authenticated` has no write grants and can't execute those RPCs. Server actions in `src/lib/orders/actions.ts` check `requirePermission` + the member's branches (`Scope`), then call the engine with the admin client.
- The engine has no Next.js imports so scripts/tests/webhooks can use it. Bots/webhooks pass `actor: { type: "bot" }` and `scope.branchIds: null` (any branch of that restaurant — resolve the restaurant from the WhatsApp number first).
- State machine lives in `src/lib/orders/status.ts` AND in Postgres (`private.order_transition_allowed` + role checks in `transition_order_status`). Change both together. Late cancels (preparing/ready) are manager+; kitchen only does accepted→preparing→ready; held orders can only be cancelled.
- Optimistic locking: every write passes `expectedVersion`. On `VERSION_CONFLICT` show "already updated by someone else" and refresh.
- Idempotency: `createOrder` needs an `idempotencyKey` (one per order screen / per bot confirmation). Same key → same order.
- `emitOrderEvent(order, event)` in `src/lib/orders/events.ts` is THE hook called after every order change. Phase 6 adds WhatsApp customer notifications there — and nowhere else. It must never throw or block.
- Kitchen never sees customer phone/address: kitchen reads `kitchen_orders` (view) + `order_items`/`order_events`. Don't put PII in `order_events.data`.
- "Today" = restaurant timezone (default Asia/Karachi): use `todayRange()` from `src/lib/time.ts`, never UTC dates.
- Phones are stored E.164 via `normalizePhone()` (`src/lib/orders/phone.ts`); show with `formatPhone()`.
- Live dashboard: `OrdersLiveProvider` (dashboard layout) = realtime (joins with the user's token — required for RLS), 20s polling fallback, catch-up on reconnect, alerts/sound/title. Use `useOrdersLive()`; don't open more realtime channels for orders.
- Test data: `npm run simulate:orders -- <slug> [--every 8] [--count 10]` creates orders through the real engine.

## Kitchen screen (Phase 5A)
- `/kitchen` reads ONLY `kitchen_orders` (view) + `order_items` + `order_events` via `src/lib/kitchen/queries.ts`. Kitchen users can't read `orders`, so the kitchen listens to realtime on `order_events` (every order change writes one).
- START / READY use the normal `transitionOrderAction`; the state machine limits kitchen to accepted→preparing→ready.
- Realtime for any screen: `useLiveRefresh()` in `src/lib/realtime/use-live-refresh.ts` (token-authenticated join, polling fallback, catch-up). `useWakeLock()` keeps tablets awake.
- Cancelled/CHANGED acknowledgements and the kitchen theme are per device (localStorage).

## Printing (Phase 5B) — browser printing only
- `/print/kot/[id]`, `/print/bill/[id]`, `/print/test` render HTML receipts (`src/components/print/receipts.tsx`, black and white, `@page` sized to 80mm/58mm) and call `window.print()`. `?preview=1` = show only; `?width=58|80` overrides the restaurant setting.
- KOT data comes from the kitchen-safe view (no prices/phone/address) → kitchen can print it (`orders.print_kot`). Bills are front of house only (`orders.print_bill`).
- The "printed" timeline entry is written by `recordPrintAction` AFTER the print dialog opens — never on page load (prefetches).
- Settings: `restaurants.receipt_paper_width`, `bill_header`, `bill_footer` (`/settings/printing`). No auto-print, print queue or ESC/POS — don't add without asking.

## WhatsApp (Phase 6A) — Cloud API, no templates
- Graph API version lives ONLY in `src/lib/whatsapp/config.ts` (`GRAPH_API_VERSION`).
- Webhook: `/api/webhooks/whatsapp` (GET = verify token, POST = `X-Hub-Signature-256` check on the RAW body → log to `whatsapp_webhook_events` → 200 → process in `after()`). Restaurant = account found by `phone_number_id`; unknown numbers are ignored.
- Logic has no Next.js imports and talks to the DB through `WhatsAppStore` (`store.ts`; in-memory fake `memory-store.ts` for tests). Inbound saves go through RPC `whatsapp_record_inbound` (atomic, dedup by `wa_message_id`).
- Outbound: ONLY `sendText()` (`src/lib/whatsapp/send.ts` / `server.ts`). It enforces the 24-hour window (outside → saved as `skipped`), retries network/5xx 3 times, saves every attempt. No templates — don't add without asking.
- Access tokens: encrypted with `encryptToken()` (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`), decrypted only in server code, never selected for the browser (no column grant). Meta echoes tokens in error messages: always pass errors through `redactToken()` (done in `graph.ts`).
- Only super admin connects numbers (`/admin/whatsapp`, `src/lib/whatsapp/admin-actions.ts`, `requireSuperAdmin`). Owners see status at `/settings/whatsapp`.
- Temporary greeting (until Phase 7 AI): `greeting.ts`, once per 6h per conversation (`whatsapp_claim_auto_reply`), closed = branch switch off or outside opening hours (`isOpenAt`).
- `/inbox` is read-only for now (realtime on `whatsapp_messages`). Media download is 6B.
- Saving a connection checks with Meta that the WABA ID is real and contains the phone number ID, then subscribes our app to it (without that subscription Meta sends nothing). Test connection reports whether the subscription is on.
- Debugging: the webhook logs each step to the server console with the prefix `[whatsapp]`. Messages to numbers that aren't connected are recorded as an error on the `whatsapp_webhook_events` row.
- Test without a phone: `npm run whatsapp:fake -- [slug] [--url http://localhost:3000] [--from 923001234567]`.

## Tests
- `npm test` (vitest, pure logic) · `npm run test:rls` (database security + engine against the real DB) · `npm run test:e2e` (Playwright, uses installed Chrome; needs `npm run build` first) · `npm run test:all` runs all three.

## Soft delete
- Never hard-delete menu items, sizes, extras, options, categories (or anything an order might reference). Set `archived_at`; the API has no DELETE grant on these tables. Archived rows are hidden everywhere except reports and past orders.

## Plain words in the UI
- Show "Sizes", "Extras / Choices", "Can be removed", "Other names customers use". Never "variants", "modifiers", "aliases".

## Database & security (built in Phase 2)
- Apply migrations: `npm run db:push` (linked project). Then `npm run db:types`.
- New table checklist: `restaurant_id`, RLS enabled with policies in the SAME migration, `revoke all ... from anon, authenticated` then column-level `grant insert (...)`/`grant update (...)` so protected columns can't be written from the browser, indexes on every FK, `updated_at` trigger (`private.set_updated_at`).
- RLS helpers live in schema `private` (not exposed to the API): `private.is_super_admin()`, `is_member(restaurant_id)`, `has_role(restaurant_id, roles[])`, `has_restaurant_wide_access(restaurant_id)`, `can_access_branch(branch_id)`, `shares_restaurant(user_id)`. SECURITY DEFINER + `set search_path = ''`. Use `(select auth.uid())` in policies.
- Restaurants are created ONLY via RPC `create_restaurant_with_owner(...)`. No deletes of restaurants/memberships/audit logs via the API (deactivate instead).
- Extend `scripts/test-rls.ts` for every new table. `npm run test:rls` must pass before a phase is done.
- `profiles.is_super_admin` / `must_change_password` are not writable by users. Make someone super admin with SQL in the Supabase dashboard: `update profiles set is_super_admin = true where id = '<user uuid>';`

## Auth, roles & permissions
- Server: `getCurrentUser()`, `getCurrentMembership()`, `requireUser()`, `requireMembership()`, `requirePermission(action)` from `src/lib/auth/session.ts`. EVERY server action and route handler calls `requirePermission` first (throws `PermissionError`; pages pass `{ onDenied: "redirect" }`).
- Permissions matrix: `src/lib/auth/permissions.ts` (`PERMISSIONS`, `can(role, action)`). Add new actions there; keep it consistent with RLS.
- Client: `usePermission(action)` hides buttons (UI only).
- Current restaurant/branch: httpOnly cookies `orderly_restaurant` / `orderly_branch`, ALWAYS re-verified against memberships on the server. `ctx.currentBranch === null` means "All branches".
- Post-login routing lives in one place: `getHomePath()` + `/auth/continue`.
- Server actions return `ActionResult` (`src/lib/action-result.ts`); use `zodFailure()` / `failure()`. Forms use `useFormAction` (doesn't wipe inputs on error).
- Audit: `writeAuditLog()` from `src/lib/audit.ts` for staff/role/restaurant changes, and (later) order edits, cancellations, refunds, price changes.
- Admin client (`createAdminClient`) only after a permission check, e.g. creating staff logins or reading staff emails.

## Next.js 16 notes (this is not the Next.js you know — read node_modules/next/dist/docs)
- Middleware is called **proxy**: `src/proxy.ts` (session refresh + optimistic redirects, not the security boundary).
- `cacheComponents` is ON: anything reading cookies/session must render inside `<Suspense>` (pattern: page returns `<Suspense fallback><AsyncContent/></Suspense>`; or wrap with `<PermissionGate action>`).
- Supabase CLI targets local by default: use `--remote` (`npm run db:push`, `npm run db:types`).

## MVP scope — DO NOT build unless asked
Inventory, recipe costing, accounting, payroll, loyalty points, marketing campaigns, foodpanda integration, native mobile apps, online payment gateways (JazzCash/Easypaisa) — schema may leave room, but no UI or logic.

## Working style
- Work in small steps. Explain the plan before big changes.
- After each task: run `npm run build`, `npm run lint`, `npm test` and `npm run test:rls`, and fix all errors.
- Demo data: `npm run seed:menu -- <restaurant-slug>` seeds a Pakistani demo menu (refuses if a menu exists).
- Do not install new packages without saying why.