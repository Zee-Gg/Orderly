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
- `emitOrderEvent(order, event)` in `src/lib/orders/events.ts` is THE hook called after every order change. WhatsApp customer notifications plug in there (via `setOrderEventHandler`, registered in `src/lib/orders/notifications.ts`, run in `after()`) — and nowhere else. It must never throw or block.
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

## WhatsApp (Phase 6A + 6B) — Cloud API, no templates
- **No WhatsApp templates in this version. All outbound messages only inside the 24-hour customer window. Messages outside the window are skipped and logged.**
- Graph API version lives ONLY in `src/lib/whatsapp/config.ts` (`GRAPH_API_VERSION`).
- Webhook: `/api/webhooks/whatsapp` (GET = verify token, POST = `X-Hub-Signature-256` check on the RAW body → log to `whatsapp_webhook_events` → 200 → process in `after()`). Restaurant = account found by `phone_number_id`; unknown numbers are ignored.
- Logic has no Next.js imports and talks to the DB through `WhatsAppStore` (`store.ts`; in-memory fake `memory-store.ts` for tests). Inbound saves go through RPC `whatsapp_record_inbound` (atomic, dedup by `wa_message_id`).
- Outbound: ONLY through `createSender()` in `src/lib/whatsapp/send.ts` (server code: `whatsappSender()` / `sendText()` in `server.ts`): `sendText`, `sendImage`, `sendDocument`, `sendLocation`, `sendInteractiveButtons`, `sendInteractiveList`. Every helper validates Meta's limits (Zod), enforces the 24-hour window (outside → saved as `skipped`), retries network/5xx 3 times, saves every attempt. No templates — don't add without asking.
- Access tokens: encrypted with `encryptToken()` (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`), decrypted only in server code, never selected for the browser (no column grant). Meta echoes tokens in error messages: always pass errors through `redactToken()` (done in `graph.ts`).
- Only super admin connects numbers (`/admin/whatsapp`, `src/lib/whatsapp/admin-actions.ts`, `requireSuperAdmin`). Owners see status at `/settings/whatsapp`.
- Inbound messages go to the AI bot through `processWebhookPayload(..., onInbound)` (see "AI bot on WhatsApp" below). The 6A greeting is gone.
- Order status messages (`order-updates.ts`, texts in `order-messages.ts`): accepted, preparing, ready (pickup only), out_for_delivery, delivered, cancelled. Each can be switched off in `/settings/whatsapp` (`restaurants.whatsapp_status_messages`). Saved with `order_id`. Customer-facing cancel reasons never reveal internal ones (e.g. "Fake order").
- Media: inbound image/audio/document are downloaded (`media.ts`: media_id → URL → bytes, max 16 MB, bigger = error on the message) into the PRIVATE bucket `whatsapp-media` at `{restaurant_id}/{message_id}.{ext}`; the path is in `whatsapp_messages.media_url`. Only the server uploads. The inbox signs URLs with the USER client (Storage RLS) for 1 hour.
- QR: `waMeLink()` / `qrSvg()` / `qrPng()` in `links.ts` (`qrcode` package). PNG at `/api/whatsapp/qr`, A5 poster at `/print/whatsapp-poster`.
- `/inbox` = full staff inbox since Phase 10 (see below).
- Saving a connection checks with Meta that the WABA ID is real and contains the phone number ID, then subscribes our app to it (without that subscription Meta sends nothing). Test connection reports whether the subscription is on.
- Debugging: the webhook logs each step to the server console with the prefix `[whatsapp]`. Messages to numbers that aren't connected are recorded as an error on the `whatsapp_webhook_events` row.
- Test without a phone: `npm run whatsapp:fake -- [slug] [--url http://localhost:3000] [--from 923001234567]`.
- Real API check of every send helper: `npm run whatsapp:send-test -- <slug> --to <number that messaged in the last 24h>`.
- E2E never calls Meta: Playwright starts a fake Graph API (`e2e/mock-graph.ts`, port 3999) and runs the app with `WHATSAPP_GRAPH_BASE_URL` pointing at it. Never set that variable in production.

## AI order bot (Phase 7A-1) — engine + playground
- Provider-agnostic via the Vercel AI SDK (`ai` v7, `generateText` + tools, `stopWhen: isStepCount(6)`). Switch with `AI_PROVIDER=google|anthropic|groq` (+ that provider's key); models, limits, cost rates in `src/lib/bot/config.ts` (`BOT_MODEL_<PROVIDER>` overrides). Keys are server-only.
- `runBotTurn()` in `src/lib/bot/agent.ts` is THE entry point (no Next.js imports). It loads the session (2h idle → abandoned → new), handles blocked customers / bot off / handed-off chats / Confirm & Cancel buttons WITHOUT the AI, calls the model, saves the session once, logs every AI turn to `ai_logs`. Rate limit or "provider busy" → one retry, then a friendly fallback + handoff. Never throws for AI problems.
- The AI only acts through tools (`src/lib/bot/tools/`, registry in `index.ts`): each validates input with Zod, runs our code, and returns `{ ok, ... }` or `{ ok: false, error: CODE, message }`. Prices ONLY from the pricing engine (`store.priceLine` = `resolveCartItem`); orders ONLY through the order engine (`store.createOrder`, source whatsapp, status awaiting_acceptance, idempotency key `bot-<session>-<summary hash>`).
- The AI sees short refs (items `I3`, sizes `S2`, choices `O5`, cart lines `L1`) — `menu-index.ts` maps them to real ids. Never show refs to customers (the eval fails on leaks).
- CODE writes the summary, confirmation, cancel, fallback and blocked texts (`texts.ts`, 3 languages); the AI never rewrites prices. `confirm_order` only works in `awaiting_confirmation` and when the re-priced cart still matches `summary_hash`; any change after the summary needs a new summary.
- DB access goes through `BotStore` (`store.ts`; in-memory fake `testing/memory-store.ts` with the demo menu + real `priceCartItem` for unit tests).
- Prompt (`prompt.ts`): static rules + compact menu first (cacheable; Anthropic gets cache markers, Google caches implicitly), then the dynamic state. Menus over 150 items rely on `search_menu`.
- Playground: `/dev/bot-playground` (development only + super admin). Orders it creates are real and show on /orders.
- Eval: `npm run eval:bot [-- --provider google|anthropic|groq] [--only id,category] [--verbose]` runs `tests/bot-eval/cases.json` against a throwaway restaurant with the demo menu (`src/lib/menu/demo-menu.ts`) and the REAL AI; report in `test-results/`. Keep it at 90%+; add a case for every bot bug.

## AI bot on WhatsApp (Phase 7A-2)
- Pipeline: `src/lib/bot/whatsapp/pipeline.ts` (`createBotPipeline().handleInbound`), DB via `BotChannelStore` (`channel.ts`), wired in `whatsappBotHook()` (`src/lib/whatsapp/server.ts`) and called from the webhook's `after()`. No Next.js imports.
- Per inbound message: wait 4s (batching: if a newer message arrived, that one handles the batch) → per-chat lock (`bot_claim_conversation`, 60s TTL) → all unhandled inbound messages (`whatsapp_messages.bot_handled_at`) become ONE `runBotTurn` → reply via the Phase 6 send helpers (interactive buttons when `showButtons`). Messages arriving during a turn are picked up by the same run.
- Skips: restaurant `bot_enabled` off, chat `bot_enabled` off (handed off to staff), >10 messages a minute (muted 60s, `ai_logs.error_type = 'flood'`), monthly AI budget used (`restaurants.ai_monthly_budget_usd`, super admin sets it in `/admin/ai-usage`) → new chats go straight to staff (`error_type = 'budget'`).
- Buttons with one meaning are handled by CODE in `runBotTurn` (`BUTTON_TOOLS`: delivery/pickup, cash/card; Confirm/Cancel), then the AI asks the next question. Location pins → session delivery location. Image/voice/document only → fixed "please type" reply (voice is 7B). Language is detected only from what the customer typed.
- Handoff (tool, AI error, empty menu, budget): code sends `texts.handedOff`, sets `whatsapp_conversations.bot_enabled = false` + `handoff_reason/handed_off_at`. Dashboard: toast + sound (`OrdersLiveProvider` listens to `whatsapp_conversations`), red counter on Inbox nav, "Needs staff" badge.
- Orders placed by the bot (`source = whatsapp` and `created_by is null`) show an "AI" tag and an "Open WhatsApp chat" link. Staff edits of a bot order before accepting it are saved to `ai_corrections` (`src/lib/bot/corrections.ts`, in `editOrderAction`); `npm run export:corrections` turns them into eval cases (`tests/bot-eval/corrections/`).
- `/settings/whatsapp`: bot on/off, high-value COD limit, today's bot chats/orders, over-budget warning. `/admin/ai-usage`: chats, bot orders, tokens, cost today/month, cost per order, budget per restaurant (`ai_usage_summary` RPC, service role only).
- TESTS NEVER CALL AN AI: `BOT_FAKE_AI=1` makes `getModel()` return the rule-based fake (`src/lib/bot/testing/fake-model.ts`); Playwright sets it with the fake Graph API. Never set it in production. Signed-webhook conversations: `npm run whatsapp:fake -- --conversation` (server with `BOT_FAKE_AI=1` for exact checks) = `e2e/whatsapp-bot.spec.ts`. The real AI runs only in `eval:bot`.

## Voice notes (Phase 7B)
- `src/lib/bot/transcribe.ts`: `transcribeVoice()` — `TRANSCRIBE_PROVIDER` groq (default: Whisper `whisper-large-v3`, language "ur" → Urdu script, never Devanagari) or google (Gemini + audio, word for word, own provider instance with `GOOGLE_TRANSCRIBE_API_KEY`, else the chat key). No Groq key → google with a log line; a missing key never crashes. One retry on rate limit/busy. Unclear = under 1 s (no API call), empty, filler only, or a known silence hallucination ("Thank you", "شکریہ").
- `src/lib/bot/voice/`: `audio.ts` (format by magic bytes; Chrome WebM/Opus is REMUXED to Ogg/Opus by `webm-to-ogg.ts` — pure JS, no ffmpeg; durations with `music-metadata`), `handle.ts` = THE voice path for WhatsApp AND the playground: duration (> 2 min → "chota voice note") → transcription → unclear check → `ai_logs` row with `type = 'transcription'`.
- WhatsApp: the pipeline transcribes audio messages before batching, saves `whatsapp_messages.transcript/transcribe_provider`, and passes `[voice note] …` lines with `voice: true`. Failed/unclear → `voiceFailed` (no AI, counts as `mark_not_understood`: 3 → staff). Language is never detected from transcripts. Prompt: voice replies start with "🎤 Aap ne kaha: …" (what was understood, not the raw transcript). Photos/documents still get "please type".
- Playground mic (`components/bot/mic-recorder.tsx`, hold or tap, ✕, 2-min limit) → `/api/dev/bot-voice` (route, not an action: recordings can exceed 1 MB). Voice tests: `/dev/voice-tests` + `/api/dev/voice-tests|voice-eval` save to `tests/voice-eval/` (cases.json + audio/); `npm run eval:voice -- --provider groq|google|both`. Scoring (`voice/eval.ts`) transliterates Urdu script and compares sound-alike keys, so script differences don't count as errors.
- Dev tools (playground, voice tests, their routes) run when `NODE_ENV !== "production"` or `ENABLE_DEV_TOOLS=1` (Playwright only), always behind super admin, decided per request (`connection()`).
- Tests never transcribe for real: `BOT_FAKE_AI=1` also fakes transcription (`BOT_FAKE_TRANSCRIPT`). Playwright's mic test uses Chrome's fake microphone with `tests/voice-eval/fixtures/order-en.wav`. Real providers only in `eval:voice` and the playground.

## Bot knowledge (Phase 7C) — menu images, photos, bestsellers, offers, FAQs, location
- Tools in `src/lib/bot/tools/knowledge-tools.ts`: `send_menu` (≤ 5 images, first caption "Final prices aap ke order summary mein confirm honge"; else the PDF; else a text menu), `send_item_photo` (caption "name — price"; `no_photo` when none), `get_bestsellers` (tagged `bestseller` first, then 30-day top sellers at the branch via `bot_bestsellers`, max 5), `get_offers` (active NOW in the restaurant's time zone, linked item available), `search_faqs` (`matchFaqs`; NO_MATCH → "Main staff se pooch kar batata hoon" + handoff), `send_location` (pin, else address text). `get_restaurant_info` adds week hours, delivery time (prep + `branches.delivery_minutes`), payment methods, dine-in.
- Tools never send: they push `BotMedia` onto `ctx.effects.media`; `BotTurnResult.media` is sent BEFORE the reply text by the pipeline (`PipelineSender.sendMedia` → Phase 6 send helpers) and shown as bubbles in the playground.
- Every offer IS a menu item (`offers.menu_item_id` required): prices only from the pricing engine. The bot never invents deals. A new chat mentions ONE active offer once (`greetingOffer` in `dynamicPrompt`, switch: `restaurants.mention_offer_on_greeting`).
- Pure helpers (offer schedule, FAQ matching, old-image check, Google Maps links) live in `src/lib/bot/knowledge.ts` (unit-tested).
- `/settings/bot` (permission `bot.manage` = owner/manager; restaurant-wide switches are owner-only): Menu images (browser compresses to JPEG ≤ 1600px, < 1 MB, uploads straight to the `bot-media` bucket, then `addMenuMediaAction` saves the row), Offers, Questions, Restaurant info (pin from "Use my current location" or a pasted Google Maps link — short links are expanded server-side, Google hosts only). Server code: `knowledge-queries.ts`, `knowledge-actions.ts`. Yellow "old prices" banner (`MenuImageOutdatedBanner`) on /settings/bot and /menu.
- Demo: `seedDemoKnowledge()` (Friday Deal + Student Deal offers, 5 FAQs, first-branch pin) runs with `seed:menu` and in the eval/test restaurant. Eval cases can set `at` (restaurant time; default Sunday 13:00 = no offers), `setup` (menu images/PDF/photos), `tools_include`, `tools_none`, `media`, `subtotal`.

## Customer menu page (Phase 8) — /m/[slug]
- Public, no login, skipped by the proxy. Server-rendered: `loadPublicMenu()` (`src/lib/menu-page/data.ts`, `"use cache"`, tag `publicMenuTag(restaurantId)`) = RPC `get_public_menu_info` + `getBranchMenu` (engine prices). `pageState()` per request: open/closed, today's hours, "opens at", active offers. Clear the cache with `revalidatePublicMenu(restaurantId)` (`src/lib/menu/public-cache.ts`) after ANY change the page shows — already called from menu, stock, branch, restaurant, offers/bot-info and WhatsApp-connection actions.
- Browser code is small: `src/components/menu-page/` (no shared UI kit, no zod). Prices on the page come from `priceMenuItem()` in `pricing.ts` (the same `priceCartItem`, fed from the branch menu) and totals from `computeOrderTotals` — never arithmetic in components. Cart = choices only, in localStorage per restaurant (`cart.ts`, `useSyncExternalStore`). Language: cookie `orderly_menu_lang` (en | ur), Urdu = RTL + `font-mixed-urdu` (Latin in Inter, Urdu in Nastaliq; the Nastaliq font loads only in Urdu).
- Send: `POST /api/public/cart-drafts` → `createCartDraft()` (`src/lib/menu-page/drafts.ts`): Zod, restaurant open + WhatsApp connected, 20 drafts/hour per IP (HMAC hash), ≤ 30 lines, every line re-priced with `resolveCartItem` (invalid lines returned by index), unique code (`code.ts`). Then the page opens `wa.me/<number>?text=` ("Hi! Mera order code: 7K3P 🛒" + the list + order type). Views: `POST /api/public/menu-views` (once per tab session).
- Bot side is CODE, not AI (`src/lib/bot/cart-draft.ts`, in `runBotTurn` before the AI): a valid code anywhere in the message (any case; spaces/dashes after the word "code") → claim the draft (single use, atomic) → re-price every line NOW, skip what can't be sold → code writes "🛒 Aap ka order mil gaya: …" and the AI gets a NOTE instead of the message (so it never re-adds items) and asks the next missing thing. Expired/used/unknown code (with the word "code") → `texts.codeExpired` + menu link. A cart already in the chat → "Replace / Add" buttons (`cart_replace` / `cart_add`, code kept in `bot_sessions.pending_cart_code`). The page's own message never changes the chat language (only Urdu script does).
- Links: `menuPageUrl()` uses `NEXT_PUBLIC_SITE_URL` (set it to the public URL — ngrok in testing); dashboard links use the request host when it's unset. `send_menu` sends the link after the menu images (first when there are none); a new chat's first reply gets one "📋 Menu …" line. `/settings/whatsapp`: link + Copy/Share, menu QR (`/api/whatsapp/qr?type=menu`), poster `?qr=menu`, funnel stats (`src/lib/menu-page/stats.ts`).

## Riders and delivery zones (Phase 9)
- Riders log in at `/rider/login` with phone + 6-digit PIN (`src/lib/riders/login.ts`): hidden auth email `riderEmail(phone)`, 5 wrong PINs → 15-minute lock (`rider_login_failed` RPC). The proxy sends signed-out `/rider` visitors there. Managers add/edit/reset PIN/switch off riders and settle cash on `/riders` (`src/lib/riders/actions.ts`, `queries.ts`).
- Rider status changes ONLY through the order engine + state machine: `status.ts` and `transition_order_status` allow a rider ready→out_for_delivery→delivered|failed on THEIR orders (checked again in the RPC). "Delivered" with cash → `recordCodCollection` (different amount needs a reason). "Refused" → `customers.refused_count` +1 (existing rule).
- Assign / reassign / unassign: `assignRider` in the engine (RPC `assign_order_rider`, writes order events) via `assignRiderAction` (`riders.assign`). UI: `AssignRider` (`src/components/orders/assign-rider.tsx`) on preparing/ready delivery cards and in the drawer; the live snapshot carries `riders` (online first, active count). The rider page (`/rider`) listens to realtime on its own orders (`rider_id=eq.<id>`) + polling, chimes/vibrates on new orders, keeps the screen on.
- "On the way" WhatsApp message includes the rider's name (and phone only if `restaurants.share_rider_phone_with_customer`).
- Delivery zones: `matchDeliveryZone()` in `src/lib/delivery/zones.ts` (pure, unit-tested): area text vs names/aliases (fuzzy; numbers must match: Phase 5 ≠ Phase 6), radius check with a pin + branch coordinates + `max_delivery_radius_km`, then the unlisted-area policy. Bot: `applyDeliveryZone()` (`src/lib/bot/delivery.ts`) in `set_delivery_address` and on location pins; `deliveryTerms()` gives the fee + minimum used by the summary/confirm (code, never the AI); out of range → "Maazrat, is area mein delivery nahi hoti" + offer pickup; below minimum → `add_at_least`. Unlisted area at the default fee → order risk flag "Area not in list — check". Staff order screen: area dropdown fills the fee; typing another fee needs `orders.delivery_fee` (enforced in `createOrderAction`). Menu page: optional area picker, "fee depends on your area".
- `/settings/delivery` (`delivery.manage`): zones per branch, radius, unlisted policy, share rider phone.

## WhatsApp inbox (Phase 10)
- `/inbox` (owner/manager/staff: `inbox.access`; kitchen/riders none): `src/components/inbox/` (`inbox-app.tsx` list + filters, `chat-view.tsx` chat + composer, `customer-panel.tsx`). Desktop 3 columns; mobile list → full-screen chat. Live: realtime on `whatsapp_conversations` + `whatsapp_messages` + polling.
- Server: `src/lib/inbox/queries.ts` (reads, user client), `actions.ts` (permission first, then admin client scoped to the restaurant), pure rules in `rules.ts` (24-hour window, filters, waiting time, auto-resolve, quick-reply search).
- Rules: the bot replies only when the chat's `bot_enabled` is on. Staff sending (`inbox.reply`) or "Take over" turns it off (system line). "Hand back" turns it on; the bot waits for the next customer message. "Resolve" = resolved + bot on. A resolved chat reopens with the bot on when the customer writes. Auto-resolve (`restaurants.auto_resolve_hours`, default 6): done atomically in `whatsapp_record_inbound` (before the bot decides) and by the `inbox_auto_resolve` sweep on inbox loads.
- Messages carry `sender_type` (customer | bot | staff | system) and `sent_by_user_id`; `send()` takes `{ senderType, sentByUserId }` and saves the content in `raw` (Retry). Grey system lines (`addSystemLine()` in `src/lib/inbox/system.ts`) are never sent to WhatsApp: handoffs, takeovers, hand-backs, resolves, assignments, bot orders.
- Needs staff = `whatsapp_conversations.needs_staff` (+ `needs_staff_since`), set by the bot handoff; turns red after `needs_staff_alert_minutes`. Opening a chat resets `unread_count` and sends a WhatsApp read receipt (`markRead`). Alerts: `OrdersLiveProvider` (needs staff toast/sound; new message in a staff-handled chat → sound + toast + Inbox badge).
- Composer: Enter sends, "/" quick replies (`quick_replies`, defaults seeded per restaurant, `/settings/quick-replies`), emoji, photo (browser JPEG → `/api/inbox/upload` → public `bot-media/{rid}/inbox/` → `sendImageAction`), Send menu (= bot's send_menu), location, menu link. Outside the 24-hour window the input is disabled (no templates).
- Customer panel: "Create order from this cart" → `/orders/new?cart=<bot session id>&phone=…` (composer `prefill`), "New order for this customer", internal notes (`conversation_notes`), tags, block.

## Reports (Phase 11)
- **SALES = orders with status `delivered` or `completed`.** Cancelled and failed are counted separately, never in sales; `pending_confirmation` is ignored. One definition everywhere: `SALE_STATUSES` / `isSaleStatus()` (`src/lib/orders/constants.ts`), the `report_*` RPCs, and the top bar ("Done today" / "Sales today" in `getLiveSnapshot`). Orders count by `created_at` in the restaurant's time zone.
- RPC pattern (migration `20261122100000_reports.sql`): `public.report_<name>(p_restaurant_id, p_branch_id (null = all branches), p_from date, p_to date)`, `language plpgsql stable SECURITY INVOKER` (RLS still applies), first line `private.report_scope(...)` = owner/manager (or super admin) only, "all branches" = owner only, branch must belong to the restaurant, ≤ 400 days; it returns the time zone. Bounds: `p_from::timestamp at time zone tz` … `(p_to + 1)::timestamp at time zone tz`. RETURNS TABLE functions start with `#variable_conflict use_column`. Aggregate in SQL — never load all orders into the app. Execute granted to `authenticated` only.
- RPCs: `report_overview` (totals, type/payment/channel splits, cancel reasons, prep/delivery minutes, late, new/returning customers), `report_daily`, `report_hours`, `report_items` (top + 5 slowest active items), `report_riders`, `report_top_customers` (phone masked in SQL: `private.mask_phone` → 0300-***4567), `report_bot` (bot chats, bot orders, handoffs, menu views → carts → orders), `report_branches` (owner, all branches), `report_orders_export`. Channel words: `private.report_channel()` (bot / menu_page / whatsapp_staff / phone / walk_in).
- App: `src/lib/reports/` — `range.ts` (pure: Today/Yesterday/This week/This month/Last month/Custom; compare = same weekday last week for one day, same days of last month for "This month", else the previous period of the same length), `summary.ts` (the friendly sentence, CODE templates — never AI), `queries.ts` (`getReport`, user client), `csv.ts`, `labels.ts`. UI: `/reports` + `src/components/reports/` (recharts only in `sales-chart.tsx`; everything else is plain HTML bars).
- CSV: `GET /api/reports/export?type=orders|items|riders&range&from&to&branch` (`reports.view`), Excel-safe (BOM, formula-escaped cells), phones masked, every download writes `audit_logs` `report.exported`.

## Platform, billing, production (Phase 12)
- **ONE Supabase project for development AND production.** No separate prod project. Before launch the data is wiped with a reset script. Every script that writes demo/fake data (`seed:menu`, `simulate:orders`, `whatsapp:fake`, `whatsapp:send-test`) calls `requireDemoDataAllowed()` (`scripts/lib/demo-guard.ts`): refuses unless `ALLOW_DEMO_DATA=true`, always warns it writes to the live DB. New demo/fake-data scripts MUST call it. `npm run seed:plans` is safe (only creates plans when none exist). `npm run reset:launch -- --admin-email <email> [--dry-run]` (`scripts/reset-for-launch.ts`) wipes ALL data except plans, platform_settings and the super admin (backup to git-ignored `backups/` first, typed ref + RESET); never run it from an agent.
- Subscriptions (migration `20261123100000_platform.sql`): `plans`, `restaurant_subscriptions` (status trial | active | past_due | suspended | cancelled), `subscription_payments` (manual: bank_transfer | jazzcash | easypaisa | cash; `receipt_number`), `platform_settings` (one row: trial days 14, grace days 5, how-to-pay text, sales WhatsApp, support phone). A trigger creates a trial subscription for every new restaurant; another syncs `restaurants.status` (trial→trial, active/past_due→active, suspended/cancelled→suspended) — `restaurants.status` stays THE access switch. Record payment = RPC `admin_record_subscription_payment` (+1 month, active). Pure rules in `src/lib/billing/core.ts` (banners, limits), reads in `queries.ts`.
- **Suspension** (nothing deleted): `requirePermission` throws/redirects to `/suspended` for everything except `SUSPENDED_ALLOWED` (`billing.view`); the dashboard layout redirects too. Bot: one fixed reply per chat ("Online ordering abhi available nahi. Please call: …", `whatsapp_conversations.suspended_notice_at`), then silence, no AI. Menu page: "not available" (existing status check; super admin actions + the daily cron clear its cache).
- Plan limits only WARN (owner banner `OwnerNotices`, `/admin` "Over plan limits"); orders are never blocked.
- Super admin (`/admin`, `requireSuperAdmin` + admin client, `src/lib/admin/queries.ts` + `actions.ts`, every change audited): overview, restaurants list/detail (suspend/reactivate, extend trial, change plan, record payment, notes, delete customer), create restaurant + owner login (`admin_create_restaurant`, temp password + `must_change_password`), read-only **support view** (writes `support.viewed` on every visit; no phones/addresses), plans & platform settings, `/admin/health`.
- Onboarding checklist: `getOnboardingChecklist()` (`src/lib/onboarding/checklist.ts`, auto-checked), `/settings/setup` + owner banner until complete, also on the admin restaurant page.
- Scheduled jobs: pg_cron (`orderly-*`: inbox auto-resolve 15 min, abandon bot sessions 30 min, subscription sweep hourly, cart-draft/rate-limit cleanup daily) → `private.job_*`, each writes `job_runs`. App jobs: `/api/cron/*` with `Authorization: Bearer CRON_SECRET` (Vercel Cron in `vercel.json`, daily on Hobby) → `/api/cron/maintenance` = `run_maintenance_jobs()` + refresh menu caches; record with `record_app_job`.
- Security: `/dev` + `/api/dev` 404 in production at the proxy (unless `ENABLE_DEV_TOOLS=1`); security headers/CSP in `next.config.ts` (add new external hosts there); DB rate limits `rateLimit()` / `rateLimitByIp()` (`src/lib/security/rate-limit.ts`, HMAC keys, fail open) on login/signup/reset/rider login/menu views/webhook bad signatures/health; logs pass through `scrubText()` (`src/lib/monitoring/scrub.ts`) — never log phones, addresses, emails or tokens in full. Review: `docs/security-review.md`.
- Monitoring: Sentry (`src/instrumentation.ts`, `src/instrumentation-client.ts`, `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`, errors only, PII scrubbed in `beforeSend`), `/api/health` (DB ping for UptimeRobot), `/admin/health` (webhooks, failed sends, AI errors, jobs, AI paid-tier warning `aiTierWarning()` — set `AI_PROVIDER_TIER=paid`; fill the cost rates marked TODO in `src/lib/bot/config.ts`).
- Privacy: owner CSV export `/api/settings/export?type=orders|customers|menu` (`data.export`, audited); customer deletion RPC `delete_customer_data` via `deleteCustomerData()` (`src/lib/privacy/`) — orders become "Deleted customer", chats/messages/transcripts/addresses/media removed, audited `customer.deleted`. Legal pages `/privacy`, `/terms`, `/contact` (replace `[PLACEHOLDERS]`).
- Public: `/` = landing for signed-out visitors (proxy sends signed-in users to `/auth/continue`); plans + sales number from `loadPublicPlatform()` (cached, `revalidatePlatform()` after admin changes). PWA: `src/app/manifest.ts` + `public/icons/` (`node scripts/generate-icons.mjs`), no offline caching.
- Production: Vercel region `bom1` (Supabase Mumbai), `maxDuration = 60` on the WhatsApp webhook (bot runs in `after()`) and cron. All env vars documented in `.env.example`. Guides: `docs/deployment.md` (incl. working safely after launch + restore), `docs/restaurant-onboarding.md`, `docs/launch-checklist.md`, `docs/staff-guides/`.

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
- Restaurants are created ONLY via RPC `create_restaurant_with_owner(...)` (signup) or `admin_create_restaurant(...)` (super admin, service role). No deletes of restaurants/memberships/audit logs via the API (deactivate instead).
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
- Demo data: `npm run seed:menu -- <restaurant-slug>` seeds a Pakistani demo menu (refuses if a menu exists; needs `ALLOW_DEMO_DATA=true` — shared live database).
- Do not install new packages without saying why. (`sharp` is a direct dependency since 7C: item photos → JPEG for WhatsApp.)