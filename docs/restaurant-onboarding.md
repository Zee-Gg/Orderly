# Bringing a new restaurant live — my checklist

Plan about **3–5 days** from the first call to the first real order (Meta verification can take 1–3 days). Tick each box.

## A. Before setup (with the owner)

- [ ] Agree on the plan and price. Explain the free trial and the monthly payment (bank / JazzCash / Easypaisa / cash).
- [ ] Get: restaurant name, city, phone, branches with addresses, opening hours, the owner's name + email, delivery areas + fees + minimum order, payment methods they accept (cash / card on delivery), how many riders.
- [ ] Get the **menu** (photos of the printed menu or a list): categories, items, sizes, prices, extras, Urdu names if they want.
- [ ] A **phone number for WhatsApp** that is NOT on the normal WhatsApp or WhatsApp Business app. Best: a new SIM. (If it's on WhatsApp now, the account must be deleted first — chats are lost.)

## B. Meta / WhatsApp (their business, their number)

Two ways — pick one:

**1. Their own Meta Business (recommended: they own the number)**
- [ ] Owner creates a **Meta Business account** (business.facebook.com) with the restaurant's legal/trade name, address, website or Facebook page.
- [ ] **Business verification**: Business settings → Security Center → Start verification. Documents: NTN certificate, utility bill or bank statement in the business name. Takes 1–3 days.
- [ ] They add **our business as a partner** (Business settings → Partners) OR we create the WhatsApp account with them on a call.

**2. Under our Meta Business (faster to start)**
- [ ] We add the number to our WhatsApp Business Account.

Then, either way:
- [ ] WhatsApp Manager → **Add phone number** → display name = restaurant name (Meta reviews it; follow their naming rules) → verify with the SMS/voice code from the owner's phone.
- [ ] **Payment method** in WhatsApp Manager (Meta may need a card on file even though our replies within 24 hours are free).
- [ ] Two-step verification PIN on the number — save it in our password manager.
- [ ] **System user token**: Business settings → Users → System users → Add (admin) → Add assets: the app + the WhatsApp account (full control) → Generate token with `whatsapp_business_messaging` + `whatsapp_business_management`, **no expiry**. Save it in the password manager.
- [ ] Copy the **Phone number ID** and **WhatsApp Business Account ID** (WhatsApp Manager / API Setup).

## C. Create the restaurant in Orderly

- [ ] `/admin/restaurants/new`: name, menu link (slug), city, phone, first branch, owner name + email, temporary password (generated), plan, trial days.
- [ ] Send the owner: login link, email, temporary password. They must change the password on first login.
- [ ] `/admin/whatsapp`: connect the number (phone number ID, WABA ID, system user token, branch) → **Test connection** → subscription ON.

## D. Set up the restaurant (with the owner, or for them)

- [ ] **Settings → Restaurant**: logo, phone, city.
- [ ] **Settings → Branches**: every branch, address, opening hours, map pin, prep time, delivery time, "late order" minutes.
- [ ] **Menu**: categories, items, sizes, extras/choices, "can be removed" options, "other names customers use", photos. At least the bestsellers with photos. Check prices twice.
- [ ] **Settings → Delivery areas**: areas + fees + minimum order per branch, radius, what to do with unlisted areas.
- [ ] **Riders**: add each rider (name, phone, branch, 6-digit PIN). Show them `/rider/login` on their phone, "Add to Home Screen".
- [ ] **Printer**: Settings → Printing → paper width (80/58 mm), bill header/footer → **Print test slip** on the counter computer. Set the browser's default printer and turn off headers/footers in the print dialog.
- [ ] **Bot knowledge** (Settings → Bot knowledge): menu photos, offers, common questions (timings, delivery areas, parking, halal, etc.), location pin.
- [ ] **Settings → WhatsApp**: bot ON, high-value cash order limit, which order updates to send.
- [ ] **Staff accounts** (Settings → Staff): managers, cashiers, kitchen. One account per person. Kitchen tablet: log in as kitchen, open `/kitchen`, Add to Home Screen.
- [ ] Print the **QR posters** (WhatsApp + menu) from Settings → WhatsApp → poster. Put them on tables, counter, delivery bags.
- [ ] Print the **staff guides** from `docs/staff-guides/` for each role.

## E. Test before going live

- [ ] From MY phone: WhatsApp the number → order 2 items with a size and an extra → delivery → cash → confirm. Check: summary prices are right, order appears on the dashboard with a sound.
- [ ] Accept → kitchen screen shows it → Start → Ready → assign rider → rider phone gets it → On the way → Delivered (cash).
- [ ] KOT and bill print correctly.
- [ ] Send a **voice note** order. Send "menu", "timing kya hai", a location pin.
- [ ] Open the menu page link → add items → send to WhatsApp → the code loads the cart.
- [ ] Staff takes over a chat from the Inbox and replies; hand back to the bot.
- [ ] Cancel one test order. Check reports show the right numbers.
- [ ] `/settings/setup` checklist: all green. `/admin/restaurants/<id>`: checklist all green.

## F. Go live

- [ ] Tell the owner which day it starts; staff on shift know the dashboard.
- [ ] First day: I watch `/admin/health` and the Inbox's "Needs staff" chats, call the owner in the evening.
- [ ] After the trial: record their payment in `/admin/restaurants/<id>` → **Record payment**, send the receipt link.
