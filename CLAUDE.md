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
- After each task: run `npm run build`, `npm run lint` and `npm run test:rls`, and fix all errors.
- Do not install new packages without saying why.