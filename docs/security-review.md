# Security review — Phase 12

Date: 2026-11-13. What was checked before launch, what was fixed, and what you must still do by hand.

## 1. Dev tools blocked in production ✅

- `/dev/*` (bot playground, voice tests, component gallery) and `/api/dev/*` return **404 in production** at the proxy (`src/proxy.ts`), before any page or route runs. The only exception is `ENABLE_DEV_TOOLS=1` (Playwright test builds — never set it in production).
- They are ALSO checked again inside: pages call `devToolsEnabled()` + `requireSuperAdmin()`, routes call `devToolGuard()`, playground server actions refuse when dev tools are off.

## 2. Security headers ✅ (`next.config.ts`)

| Header | Value |
|---|---|
| Content-Security-Policy | `default-src 'self'`; scripts/styles self + inline (needed by Next.js); images/audio self + Supabase; connect self + Supabase (https + wss) + Sentry; `frame-ancestors 'none'`; `object-src 'none'`; `form-action` self + Supabase + Google sign-in; `upgrade-insecure-requests` |
| Strict-Transport-Security | 2 years, includeSubDomains, preload |
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera off, **microphone off** (allowed only on `/dev/*` voice tools), geolocation self ("Use my current location"), payment/usb off |

`poweredByHeader` is off. Note: `'unsafe-inline'` scripts are required by Next.js without nonces; moving to nonces is possible later but makes every page dynamic.

## 3. Rate limits ✅ (`src/lib/security/rate-limit.ts`, table `rate_limits`)

Keys are HMAC hashes (never raw IPs). If the database can't be reached, requests are allowed (Supabase Auth has its own limits).

| Endpoint | Limit |
|---|---|
| Login (email) | 20 / 10 min per IP |
| Sign up | 5 / hour per IP |
| Forgot password | 5 / hour per IP |
| Rider login | 30 / 15 min per IP, plus 5 wrong PINs → 15-minute lock per phone (existing) |
| Menu page cart drafts | 20 / hour per IP (existing, Phase 8) |
| Menu page views | 120 / hour per IP (extra hits ignored) |
| WhatsApp webhook | signature check on every request; body over 1 MB refused; 20 failed signatures / 10 min per IP → 429 |
| `/api/health` | 30 / min per IP |
| `/api/cron/*` | needs `CRON_SECRET` |

## 4. Secrets never reach the browser ✅

- Checked the production build: every server-only value in `.env.local` (Supabase secret key, WhatsApp app secret + verify token, token encryption key, AI keys) was searched for in all browser files in `.next/static` → **not found**.
- Only `NEXT_PUBLIC_*` variables reach the browser: Supabase URL, publishable key, site URL, Sentry DSN (none are secrets).
- Server modules that use secrets import `server-only` (Supabase admin client, WhatsApp server code, session helpers).
- WhatsApp tokens are encrypted (AES-256-GCM) and have no column grant for the browser. Meta errors pass through `redactToken()`.
- `CRON_SECRET` is only read by `/api/cron/maintenance`.

## 5. Row Level Security on every table ✅

All **45** tables in `public` have RLS **enabled**. Tables with RLS on but **no policies** (= nobody can read them through the API; only the server's service role):
`order_counters`, `rate_limits`, `rider_login_attempts` — intentional.

## 6. Supabase advisors

Run: `npx supabase db advisors --remote --type all --level info`.

Fixed in this phase:
- **Multiple permissive policies** on `orders`, `order_items`, `order_item_modifiers`, `rider_profiles` → merged into one policy each (same access, faster). Migration `20261123100200_security_fixes.sql`.
- `get_public_menu` (old, unused) was callable without login → closed to the API.
- Missing indexes on single-column foreign keys (orders → settlement/zone/created_by/cancelled_by, payments, order events, messages) → added (`20261123100300_fk_indexes.sql`).

Remaining — reviewed and **intentional**:
| Finding | Why it's OK |
|---|---|
| ERROR `security_definer_view` on `kitchen_orders` | Kitchen users must NOT read `orders` (phone, address, money). The view shows only kitchen-safe columns and its WHERE clause checks the role + branch (`has_role`, `can_access_branch`). |
| `get_public_menu_info` callable by anon | It IS the public menu page. Returns only what the page shows, only for trial/active restaurants. |
| `create_restaurant_with_owner`, `is_slug_available`, `set_item_stock`, `restaurant_usage` callable by signed-in users | Each checks permission inside (owner/manager/staff/super admin) before doing anything. |
| INFO "unindexed foreign keys" on `(id, restaurant_id)` pairs | Each already has an index on the id column; the pair only matters when a whole restaurant is deleted (never via the API). |
| INFO "unused index" | Indexes for features with little data yet. Recheck after a few months of real traffic. |

## 7. Logs don't show personal data ✅

- WhatsApp and bot logs (`[whatsapp]`, `[bot]`) pass through `scrubText()` (`src/lib/monitoring/scrub.ts`): phone numbers become `0300***4567`, emails `[email]`, tokens/keys/JWTs `[token]`/`[key]`/`[jwt]`.
- Logs mostly print ids, not personal data. Order events never contain phone/address (Phase 4 rule).
- Sentry: `sendDefaultPii: false`; `beforeSend` removes the user, cookies, headers, request body and query string, and scrubs messages, exception text and breadcrumbs. No session replay, no tracing.

## 8. npm audit

`npm audit` → **0 high, 0 critical**. 12 moderate, all inside build-time tooling (`@sentry/bundler-plugins` → `glob`/`minimatch`, ReDoS), which this app does not run (we don't use Sentry's build plugin). The only fix is a breaking upgrade to `@sentry/nextjs@11`; revisit when convenient.

## 9. Other checks

- Suspended restaurants are blocked **on the server** (`requirePermission` → only `billing.view`; dashboard layout redirects to `/suspended`), not just hidden.
- Support view (`/admin/restaurants/[id]/support`) is read-only, shows no phones/addresses, and writes `support.viewed` to the restaurant's audit log on every visit.
- Customer deletion removes chats, transcripts, media files and addresses, anonymizes orders, and is audited (`customer.deleted`).
- CSV exports are owner/manager only and audited.

## You must do these by hand

1. **Supabase → Authentication → Attack Protection → Leaked password protection** (HaveIBeenPwned): turn ON (needs the Pro plan).
2. Supabase → Authentication → **Rate limits**: check the email-sending limits after setting up custom SMTP.
3. Turn **Confirm email** back on, set up custom SMTP (see `docs/deployment.md`).
4. Supabase → **Database → Backups**: confirm daily backups (Pro). Consider Point-in-Time Recovery.
5. Make sure production has **no** `ENABLE_DEV_TOOLS`, `BOT_FAKE_AI`, `WHATSAPP_GRAPH_BASE_URL`, and `ALLOW_DEMO_DATA` is `false`.
6. Use a **permanent System User token** for WhatsApp (not the 24-hour test token), with only the WhatsApp permissions.
7. Keep `TOKEN_ENCRYPTION_KEY`, `SUPABASE_SECRET_KEY`, `WHATSAPP_APP_SECRET`, `CRON_SECRET` only in Vercel + your password manager. If one ever leaks: rotate it (Supabase → API keys → roll; Meta → reset app secret; new `CRON_SECRET`). Rotating `TOKEN_ENCRYPTION_KEY` means reconnecting every WhatsApp number.
8. Two-factor authentication on your GitHub, Vercel, Supabase, Meta and Google accounts.
9. Have a lawyer check `/privacy` and `/terms` and replace the `[PLACEHOLDERS]`.
10. Vercel → Settings → **Deployment Protection**: keep preview deployments private (they use the live database).
