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
- src/app/(auth)        → login, signup
- src/app/(dashboard)   → staff dashboard pages
- src/app/kitchen       → kitchen display
- src/app/rider         → rider mobile page
- src/app/m/[slug]      → public customer menu page
- src/app/admin         → super admin
- src/app/api           → route handlers + webhooks
- src/components/ui     → shared UI components
- src/lib               → supabase clients, utils, validation, business logic
- supabase/migrations   → SQL migrations

## MVP scope — DO NOT build unless asked
Inventory, recipe costing, accounting, payroll, loyalty points, marketing campaigns, foodpanda integration, native mobile apps, online payment gateways (JazzCash/Easypaisa) — schema may leave room, but no UI or logic.

## Working style
- Work in small steps. Explain the plan before big changes.
- After each task: run `npm run build` and `npm run lint` and fix all errors.
- Do not install new packages without saying why.