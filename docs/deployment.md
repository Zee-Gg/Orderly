# Deployment guide — from zero to live

Orderly uses **one Supabase project** for development and production. Going live means pointing that same project at your real domain and deploying the app to Vercel. Follow the steps in order.

> Before launch you will run the **reset-for-launch script** (made separately) to wipe test data. See `docs/launch-checklist.md`.

---

## 1. Get ready

You need:

- The GitHub repo (`Zee-Gg/Orderly`).
- A Vercel account.
- Your domain, e.g. `orderly.pk`.
- The Supabase project (already used for development).
- The Meta app (WhatsApp) you used for testing.
- A paid AI key (Google Gemini, Anthropic or Groq).
- An email sending service for auth emails (Resend, Brevo, Mailgun…).

## 2. Database is up to date

On your computer:

```bash
npm run db:push      # applies any new migrations to the shared project
npm run db:types
npm run seed:plans   # creates the default plans ONLY if none exist (safe)
```

Then check in Supabase → **Database → Cron Jobs** that four `orderly-*` jobs exist (inbox auto-resolve, abandon bot sessions, cleanup cart drafts, subscription sweep).

## 3. Create the Vercel project

1. Vercel → **Add New → Project** → import the GitHub repo. Framework: Next.js (auto).
2. **Region**: `vercel.json` already sets `bom1` (Mumbai), next to the Supabase Mumbai region. Check it under Project → Settings → Functions.
3. Add the **environment variables** (Production). Every variable is listed in `.env.example`; the required ones are:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API Keys |
   | `SUPABASE_SECRET_KEY` | Supabase → Settings → API Keys (secret) |
   | `NEXT_PUBLIC_SITE_URL` | `https://your-domain.com` |
   | `WHATSAPP_APP_SECRET` | Meta App → Settings → Basic |
   | `WHATSAPP_VERIFY_TOKEN` | same value you will type in Meta |
   | `TOKEN_ENCRYPTION_KEY` | **the SAME value as in `.env.local`** (otherwise saved WhatsApp tokens can't be read) |
   | `AI_PROVIDER` + that provider's key | your paid key |
   | `AI_PROVIDER_TIER` | `paid` |
   | `CRON_SECRET` | a new long random string |
   | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | from Sentry (step 9) |
   | `ALLOW_DEMO_DATA` | `false` (or leave it unset) |

   **Never** set `ENABLE_DEV_TOOLS`, `WHATSAPP_GRAPH_BASE_URL` or `BOT_FAKE_AI` in production.
4. **Deploy**. Open `https://<project>.vercel.app/api/health`. It should show `{"status":"ok","db":"ok"}`.
5. Project → Settings → **Domains** → add your domain and follow the DNS steps. Wait for the green tick.
6. Fill in the AI cost rates in `src/lib/bot/config.ts` (marked `TODO BEFORE LAUNCH`), commit and deploy again.

## 4. Supabase Auth → your domain

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://your-domain.com`
- **Redirect URLs**: add `https://your-domain.com/auth/callback`. Remove old ngrok URLs. Keep `http://localhost:3000/auth/callback` only if you still develop locally.

## 5. Email (custom SMTP) + email confirmation

Supabase's built-in email is only for testing (a few emails per hour).

1. Create an account with an email service and verify your domain (it gives you DNS records: SPF, DKIM).
2. Supabase → **Authentication → Emails → SMTP Settings** → turn on custom SMTP: host, port, user, password, sender `no-reply@your-domain.com`, sender name `Orderly`.
3. **Authentication → Sign In / Providers → Email**: turn **Confirm email** back ON.
4. Optional: edit the email templates (Confirm signup, Reset password) in plain words.
5. Test: sign up with a new email, confirm, log in; then try "Forgot password".

## 6. Google login

1. Google Cloud Console → **APIs & Services → Credentials** → your OAuth client:
   - Authorized JavaScript origins: `https://your-domain.com`
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback` (unchanged)
2. OAuth consent screen: app name, logo, your domain, privacy URL `https://your-domain.com/privacy`, terms URL `https://your-domain.com/terms`. **Publish** the app (out of "Testing").
3. Supabase → Authentication → Providers → Google: client ID and secret are already there.

## 7. Switch the WhatsApp webhook from ngrok to Vercel

1. developers.facebook.com → your app → **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://your-domain.com/api/webhooks/whatsapp`
   - Verify token: the `WHATSAPP_VERIFY_TOKEN` value → **Verify and save**
   - Subscribed fields: **messages**
2. Put the Meta app in **Live** mode (App settings → Basic; you need the privacy URL).
3. Use **permanent** access tokens (a System User in Business Manager → System users → add the WhatsApp permissions → Generate token). The 24-hour test token stops working.
4. `/admin/whatsapp` → for each number → **Test connection** (it must say the subscription is on).
5. Send a WhatsApp message to a connected number. Check `/admin/health` → "Last webhook received".

## 8. Scheduled jobs (cron)

| Job | Where | How often |
|---|---|---|
| Auto-resolve quiet staff chats | Supabase pg_cron | every 15 min |
| Close idle bot sessions | Supabase pg_cron | every 30 min |
| Trials / payments → payment due → suspended | Supabase pg_cron | every hour |
| Clean old menu-page carts + rate-limit counters | Supabase pg_cron | daily 2:30 AM PKT |
| Backup run of all jobs + refresh menu pages of suspended restaurants | Vercel Cron → `/api/cron/maintenance` | daily 2:30 AM PKT |

- Vercel **Hobby** plan allows cron **once a day** only. That's why the frequent jobs run in Postgres (pg_cron), which has no such limit. On Vercel **Pro** you could run the Vercel job hourly by changing `vercel.json`.
- Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when `CRON_SECRET` is set.
- Check `/admin/health` → **Scheduled jobs**: all green.

## 9. Sentry (errors)

1. sentry.io → create a free account → new project → **Next.js**.
2. Copy the **DSN** into `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in Vercel → redeploy.
3. Personal data is removed before sending (`src/lib/monitoring/sentry-options.ts`).
4. Optional: Sentry → Alerts → email me on new issues.

## 10. UptimeRobot (is the site up?)

1. uptimerobot.com → free account → **Add New Monitor** → HTTP(s).
2. URL: `https://your-domain.com/api/health`, every 5 minutes.
3. Alert contact: your email and phone. It alerts you when the page stops answering `200`.

## 11. First super admin account

1. Go to `https://your-domain.com/signup` and create **your** account (use your real email).
2. Supabase → **Authentication → Users** → copy your user's UUID.
3. Supabase → **SQL Editor**:
   ```sql
   update profiles set is_super_admin = true where id = '<your user uuid>';
   ```
4. Log out and in. Open `/admin`.
5. `/admin/settings`: trial days, grace days, **how to pay** (bank / JazzCash / Easypaisa details), your WhatsApp number, support phone. Check the plans and prices.

---

## How to work safely after launch

Real restaurants now use the same database you develop against.

- **Back up before every migration.**
  - Supabase → **Database → Backups**: Pro plan has daily backups (and Point-in-Time Recovery as an add-on). Check the latest backup's date before you run `npm run db:push`.
  - Also make your own copy: `npx supabase db dump --remote -f backup-YYYY-MM-DD.sql` (schema), and `npx supabase db dump --remote --data-only -f data-YYYY-MM-DD.sql` (data). Keep these files private — they contain customer data.
- **Never run seed or simulation scripts against the live database.** Keep `ALLOW_DEMO_DATA=false` in `.env.local`. The scripts refuse to run without it.
- **Test risky things in a separate test project** (free Supabase project): link it with `npx supabase link --project-ref <test-ref>`, push migrations there first, try them, then link back to the live project.
- **Migrations only add things where possible** (new columns with defaults, new tables). Avoid dropping or renaming columns the running app still uses: deploy the code that stops using it first, drop it later.
- **Deploy order**: migration first (backwards-compatible), then the app.
- **Never** turn on `ENABLE_DEV_TOOLS`, `BOT_FAKE_AI` or `WHATSAPP_GRAPH_BASE_URL` in production.

### How to restore from a backup

- **Supabase backup (Pro)**: Database → Backups → choose the backup (or a point in time with PITR) → **Restore**. The whole database goes back to that moment; anything after it is lost. Tell restaurants first if orders could be lost.
- **From your own dump**: create a new Supabase project, then run
  `psql "<new project connection string>" -f backup-YYYY-MM-DD.sql` and then the `data-…sql` file. Point Vercel's Supabase variables at the new project and redeploy. (Auth users and storage files are not in a plain dump — prefer Supabase backups.)
- After any restore: check `/api/health`, `/admin/health`, place a test order, and send a test WhatsApp.
