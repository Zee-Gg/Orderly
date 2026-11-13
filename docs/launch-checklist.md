# Launch checklist — before the first real restaurant

Do these in order. Don't skip any.

## 1. Testing finished
- [ ] Every manual test from Phases 1–12 passed (orders, kitchen, printing, WhatsApp bot + voice, menu page, riders, inbox, reports, billing, suspension, data export, customer deletion).
- [ ] Tested on a cheap Android phone on mobile data (dashboard, rider page, menu page).
- [ ] The bot eval passed last time it was run, and AI cost rates are filled in (`src/lib/bot/config.ts`).

## 2. Wipe test data
- [ ] **Back up first**: Supabase → Database → Backups (latest backup date is today), and `npx supabase db dump --remote --data-only -f before-reset.sql`.
- [ ] Run the **reset-for-launch script** (to be created separately).
- [ ] Confirm the database is clean: no test restaurants, orders, customers, chats, AI logs, menu carts; only your super admin account (and plans + platform settings) remain. Storage buckets (`whatsapp-media`, `bot-media`, menu images) have no test files.
- [ ] `npm run seed:plans` (only creates plans if none exist), then check prices in `/admin/settings`.

## 3. Lock the shared database
- [ ] `.env.local`: `ALLOW_DEMO_DATA=false`. From now on never run `seed:menu`, `simulate:orders`, `whatsapp:fake`, `whatsapp:send-test`.
- [ ] Vercel (Production): `ALLOW_DEMO_DATA` false or missing; NO `ENABLE_DEV_TOOLS`, `BOT_FAKE_AI`, `WHATSAPP_GRAPH_BASE_URL`.

## 4. WhatsApp
- [ ] Remove the **Meta test number** connection (`/admin/whatsapp` → disconnect "+1 555…").
- [ ] Meta app in **Live** mode; privacy policy URL set.
- [ ] Permanent System User token ready for the first restaurant.

## 5. Deploy
- [ ] All steps in `docs/deployment.md` done: Vercel project, environment variables, domain, Supabase auth URLs, custom SMTP + email confirmation ON, Google login, Sentry, UptimeRobot.
- [ ] `https://your-domain.com/api/health` → `ok`.
- [ ] `/dev/bot-playground` → **404** on the live site.
- [ ] Landing page, `/privacy`, `/terms`, `/contact` load; placeholders `[APP_NAME]`, `[COMPANY]`, `[EMAIL]`, `[PHONE]`, `[CITY]`, `[DATE]` replaced.
- [ ] Response headers (browser dev tools → Network → the page) include Content-Security-Policy and Strict-Transport-Security.

## 6. Switch the webhook
- [ ] Meta webhook callback = `https://your-domain.com/api/webhooks/whatsapp`, verified, field **messages** subscribed.
- [ ] ngrok no longer used anywhere (`NEXT_PUBLIC_SITE_URL` = real domain).

## 7. Accounts and safety
- [ ] Your super admin account works on the live site (`/admin`).
- [ ] Leaked password protection ON, 2FA on GitHub / Vercel / Supabase / Meta / Google.
- [ ] `/admin/health`: AI tier warning gone (`AI_PROVIDER_TIER=paid`), all scheduled jobs green.
- [ ] `/admin/settings`: how-to-pay text, your WhatsApp number, support phone.

## 8. First real restaurant
- [ ] Follow `docs/restaurant-onboarding.md` from A to F.
- [ ] Place a real test order end-to-end on their number before telling customers.
- [ ] Watch `/admin/health` and Sentry closely for the first week.
