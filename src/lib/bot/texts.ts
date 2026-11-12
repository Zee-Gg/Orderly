import type { BotLanguage } from "./types";

/**
 * Customer-facing texts that CODE writes (never the AI): the order summary,
 * buttons, confirmation, fallback and blocked messages. One entry per language.
 */
type Texts = {
  summaryTitle: string;
  subtotal: string;
  deliveryFee: string;
  total: string;
  orderType: string;
  delivery: string;
  pickup: string;
  address: string;
  landmark: string;
  locationPin: string;
  payment: string;
  cod: string;
  card: string;
  name: string;
  without: (what: string) => string;
  note: string;
  confirmQuestion: string;
  orderPlaced: (n: number) => string;
  alreadyPlaced: string;
  cancelled: string;
  fallback: string;
  notUnderstood: string;
  handedOff: string;
  menuUnavailable: string;
  mediaNotSupported: string;
  chooseBelow: string;
  voiceTooLong: string;
  voiceUnclear: string;
  menuCaption: string;
  textMenuTitle: string;
  /** Menu page (Phase 8). */
  menuPageLink: (url: string) => string;
  menuLinkLine: (url: string) => string;
  cartLoaded: (lines: string[], skipped: string[]) => string;
  cartNothingAvailable: (skipped: string[]) => string;
  codeExpired: (url: string | null) => string;
  cartReplaceOrAdd: string;
  blocked: (phone: string | null) => string;
  buttons: {
    replace: string;
    add: string;
    confirm: string;
    change: string;
    cancel: string;
    delivery: string;
    pickup: string;
    cod: string;
    card: string;
  };
  status: Record<string, string>;
};

const ROMAN: Texts = {
  summaryTitle: "🧾 *Aap ka order:*",
  subtotal: "Subtotal",
  deliveryFee: "Delivery charges",
  total: "*Total*",
  orderType: "Order",
  delivery: "Delivery 🛵",
  pickup: "Pickup (khud le jayenge) 🛍️",
  address: "Address",
  landmark: "Nishani",
  locationPin: "Location pin bheja hai 📍",
  payment: "Payment",
  cod: "Cash on delivery",
  card: "Card on delivery",
  name: "Naam",
  without: (w) => `${w} nahi`,
  note: "Note",
  confirmQuestion: "Sab theek hai? *Confirm* karein ✅, *Change* ✏️ ya *Cancel* ❌",
  orderPlaced: (n) => `✅ Order #${n} mil gaya! Restaurant confirm karega to aap ko message aa jayega.`,
  alreadyPlaced: "Aap ka order pehle hi restaurant ko bhej diya gaya hai ✅ Confirm hote hi message mil jayega.",
  cancelled: "Theek hai, order cancel kar diya. Jab chahein dobara message karein 🙂",
  fallback: "Maazrat, thori der mein dobara try karein, ya staff se baat karein. Hamara staff jald aap se raabta karega 🙏",
  notUnderstood: "Maazrat, samajh nahi aaya. Thora aur bata dein? 🙂",
  handedOff: "Aap ki baat staff se karwa raha hoon, thori der mein jawab milega 🙏",
  mediaNotSupported: "Abhi sirf text messages samajh sakta hoon, please type kar dein 🙏",
  chooseBelow: "Neeche se choose karein 👇",
  voiceTooLong: "Thora chota voice note bhejein ya type kar dein 🙏",
  voiceUnclear: "Maazrat, voice note samajh nahi aaya. Dobara bhejein ya type kar dein 🙏",
  menuCaption: "Final prices aap ke order summary mein confirm honge",
  textMenuTitle: "📋 *Hamara menu*",
  menuPageLink: (url) => `Yahan se items select karein 👉 ${url}`,
  menuLinkLine: (url) => `📋 Menu dekh kar order karein 👉 ${url}`,
  cartLoaded: (lines, skipped) =>
    `🛒 Aap ka order mil gaya: ${lines.join(", ")}.${skipped.length ? `\n${skipped.join(", ")} abhi available nahi.` : ""}`,
  cartNothingAvailable: (skipped) => `Maazrat, ${skipped.join(", ")} abhi available nahi. Kuch aur order karna chahenge?`,
  codeExpired: (url) => `Ye order code expire ho gaya hai. Menu se dobara bhejein ya yahan type kar dein 🙏${url ? `\n👉 ${url}` : ""}`,
  cartReplaceOrAdd: "Aap ke cart mein pehle se items hain. Naya order un ki jagah rakhein ya saath add karein?",
  menuUnavailable: "Maazrat, abhi online menu available nahi hai. Hamara staff jald aap se raabta karega 🙏",
  blocked: (p) => `Maazrat, is number se online order nahi ho sakta.${p ? ` Order ke liye call karein: ${p}` : ""}`,
  buttons: { confirm: "✅ Confirm", change: "✏️ Change", cancel: "❌ Cancel", delivery: "🛵 Delivery", pickup: "🛍️ Pickup", cod: "💵 Cash on delivery", card: "💳 Card on delivery", replace: "🔄 Replace", add: "➕ Add" },
  status: {
    pending_confirmation: "abhi confirm nahi hua",
    awaiting_acceptance: "restaurant confirm kar raha hai",
    accepted: "confirm ho gaya",
    preparing: "tayyar ho raha hai",
    ready: "ready hai",
    out_for_delivery: "raaste mein hai",
    delivered: "deliver ho gaya",
    completed: "mukammal ho gaya",
    cancelled: "cancel ho gaya",
    failed: "deliver nahi ho saka",
  },
};

const ENGLISH: Texts = {
  summaryTitle: "🧾 *Your order:*",
  subtotal: "Subtotal",
  deliveryFee: "Delivery charges",
  total: "*Total*",
  orderType: "Order",
  delivery: "Delivery 🛵",
  pickup: "Pickup 🛍️",
  address: "Address",
  landmark: "Landmark",
  locationPin: "Location pin shared 📍",
  payment: "Payment",
  cod: "Cash on delivery",
  card: "Card on delivery",
  name: "Name",
  without: (w) => `no ${w}`,
  note: "Note",
  confirmQuestion: "Is everything correct? *Confirm* ✅, *Change* ✏️ or *Cancel* ❌",
  orderPlaced: (n) => `✅ Order #${n} received! We'll message you as soon as the restaurant confirms it.`,
  alreadyPlaced: "Your order has already been sent to the restaurant ✅ We'll message you when it's confirmed.",
  cancelled: "Okay, your order is cancelled. Message us anytime 🙂",
  fallback: "Sorry, please try again in a little while, or talk to our staff. Someone will reply to you soon 🙏",
  notUnderstood: "Sorry, I didn't get that. Could you tell me a bit more? 🙂",
  handedOff: "I'm passing you to our staff, you'll get a reply shortly 🙏",
  mediaNotSupported: "For now I can only read text messages, please type it 🙏",
  chooseBelow: "Please choose below 👇",
  voiceTooLong: "Please send a shorter voice note or type it 🙏",
  voiceUnclear: "Sorry, I couldn't understand the voice note. Please send it again or type it 🙏",
  menuCaption: "Final prices are confirmed in your order summary",
  textMenuTitle: "📋 *Our menu*",
  menuPageLink: (url) => `Pick your items here 👉 ${url}`,
  menuLinkLine: (url) => `📋 See the menu and order here 👉 ${url}`,
  cartLoaded: (lines, skipped) =>
    `🛒 Got your order: ${lines.join(", ")}.${skipped.length ? `\n${skipped.join(", ")} ${skipped.length === 1 ? "is" : "are"} not available right now.` : ""}`,
  cartNothingAvailable: (skipped) => `Sorry, ${skipped.join(", ")} ${skipped.length === 1 ? "is" : "are"} not available right now. Would you like something else?`,
  codeExpired: (url) => `This order code has expired. Please send it again from the menu, or type your order here 🙏${url ? `\n👉 ${url}` : ""}`,
  cartReplaceOrAdd: "You already have items in your cart. Replace them with the new order, or add to them?",
  menuUnavailable: "Sorry, our online menu isn't available right now. Our staff will contact you shortly 🙏",
  blocked: (p) => `Sorry, online ordering isn't available for this number.${p ? ` Please call us to order: ${p}` : ""}`,
  buttons: { confirm: "✅ Confirm", change: "✏️ Change", cancel: "❌ Cancel", delivery: "🛵 Delivery", pickup: "🛍️ Pickup", cod: "💵 Cash on delivery", card: "💳 Card on delivery", replace: "🔄 Replace", add: "➕ Add" },
  status: {
    pending_confirmation: "not confirmed yet",
    awaiting_acceptance: "waiting for the restaurant to accept",
    accepted: "confirmed",
    preparing: "being prepared",
    ready: "ready",
    out_for_delivery: "on the way",
    delivered: "delivered",
    completed: "completed",
    cancelled: "cancelled",
    failed: "could not be delivered",
  },
};

const URDU: Texts = {
  summaryTitle: "🧾 *آپ کا آرڈر:*",
  subtotal: "سب ٹوٹل",
  deliveryFee: "ڈیلیوری چارجز",
  total: "*کل رقم*",
  orderType: "آرڈر",
  delivery: "ڈیلیوری 🛵",
  pickup: "پک اپ (خود لے جائیں گے) 🛍️",
  address: "پتہ",
  landmark: "نشانی",
  locationPin: "لوکیشن بھیجی گئی 📍",
  payment: "ادائیگی",
  cod: "کیش آن ڈیلیوری",
  card: "کارڈ آن ڈیلیوری",
  name: "نام",
  without: (w) => `بغیر ${w}`,
  note: "نوٹ",
  confirmQuestion: "کیا سب ٹھیک ہے؟ *کنفرم* ✅، *تبدیلی* ✏️ یا *کینسل* ❌",
  orderPlaced: (n) => `✅ آرڈر #${n} مل گیا! ریسٹورنٹ کنفرم کرے گا تو آپ کو پیغام آ جائے گا۔`,
  alreadyPlaced: "آپ کا آرڈر پہلے ہی ریسٹورنٹ کو بھیج دیا گیا ہے ✅ کنفرم ہوتے ہی پیغام مل جائے گا۔",
  cancelled: "ٹھیک ہے، آرڈر کینسل کر دیا۔ جب چاہیں دوبارہ پیغام کریں 🙂",
  fallback: "معذرت، تھوڑی دیر میں دوبارہ کوشش کریں، یا عملے سے بات کریں۔ ہمارا عملہ جلد آپ سے رابطہ کرے گا 🙏",
  notUnderstood: "معذرت، سمجھ نہیں آیا۔ تھوڑا اور بتا دیں؟ 🙂",
  handedOff: "آپ کی بات عملے سے کروا رہا ہوں، تھوڑی دیر میں جواب ملے گا 🙏",
  mediaNotSupported: "ابھی صرف ٹیکسٹ پیغامات سمجھ سکتا ہوں، براہ کرم لکھ دیں 🙏",
  chooseBelow: "نیچے سے منتخب کریں 👇",
  voiceTooLong: "تھوڑا چھوٹا وائس نوٹ بھیجیں یا لکھ دیں 🙏",
  voiceUnclear: "معذرت، وائس نوٹ سمجھ نہیں آیا۔ دوبارہ بھیجیں یا لکھ دیں 🙏",
  menuCaption: "حتمی قیمتیں آپ کے آرڈر کی سمری میں کنفرم ہوں گی",
  textMenuTitle: "📋 *ہمارا مینو*",
  menuPageLink: (url) => `یہاں سے آئٹمز منتخب کریں 👉 ${url}`,
  menuLinkLine: (url) => `📋 مینو دیکھ کر آرڈر کریں 👉 ${url}`,
  cartLoaded: (lines, skipped) =>
    `🛒 آپ کا آرڈر مل گیا: ${lines.join("، ")}۔${skipped.length ? `\n${skipped.join("، ")} ابھی دستیاب نہیں۔` : ""}`,
  cartNothingAvailable: (skipped) => `معذرت، ${skipped.join("، ")} ابھی دستیاب نہیں۔ کچھ اور آرڈر کریں گے؟`,
  codeExpired: (url) => `یہ آرڈر کوڈ ختم ہو گیا ہے۔ مینو سے دوبارہ بھیجیں یا یہاں لکھ دیں 🙏${url ? `\n👉 ${url}` : ""}`,
  cartReplaceOrAdd: "آپ کے کارٹ میں پہلے سے آئٹمز ہیں۔ نیا آرڈر ان کی جگہ رکھیں یا ساتھ شامل کریں؟",
  menuUnavailable: "معذرت، ابھی آن لائن مینو دستیاب نہیں۔ ہمارا عملہ جلد آپ سے رابطہ کرے گا 🙏",
  blocked: (p) => `معذرت، اس نمبر سے آن لائن آرڈر نہیں ہو سکتا۔${p ? ` آرڈر کے لیے کال کریں: ${p}` : ""}`,
  buttons: { confirm: "✅ کنفرم", change: "✏️ تبدیلی", cancel: "❌ کینسل", delivery: "🛵 ڈیلیوری", pickup: "🛍️ پک اپ", cod: "💵 کیش آن ڈیلیوری", card: "💳 کارڈ آن ڈیلیوری", replace: "🔄 تبدیل کریں", add: "➕ شامل کریں" },
  status: {
    pending_confirmation: "ابھی کنفرم نہیں ہوا",
    awaiting_acceptance: "ریسٹورنٹ کنفرم کر رہا ہے",
    accepted: "کنفرم ہو گیا",
    preparing: "تیار ہو رہا ہے",
    ready: "تیار ہے",
    out_for_delivery: "راستے میں ہے",
    delivered: "ڈیلیور ہو گیا",
    completed: "مکمل ہو گیا",
    cancelled: "کینسل ہو گیا",
    failed: "ڈیلیور نہیں ہو سکا",
  },
};

export const TEXTS: Record<BotLanguage, Texts> = { roman_urdu: ROMAN, english: ENGLISH, urdu: URDU };

export const t = (lang: BotLanguage) => TEXTS[lang];
