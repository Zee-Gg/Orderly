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
  blocked: (phone: string | null) => string;
  buttons: {
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
  orderPlaced: (n) => `✅ Shukriya! Aap ka order #${n} restaurant ko bhej diya gaya hai. Confirm hote hi aap ko message mil jayega.`,
  alreadyPlaced: "Aap ka order pehle hi restaurant ko bhej diya gaya hai ✅ Confirm hote hi message mil jayega.",
  cancelled: "Theek hai, order cancel kar diya. Jab chahein dobara message karein 🙂",
  fallback: "Maazrat, thori der mein dobara try karein, ya staff se baat karein. Hamara staff jald aap se raabta karega 🙏",
  notUnderstood: "Maazrat, samajh nahi aaya. Thora aur bata dein? 🙂",
  handedOff: "Hamara staff jald aap se baat karega 🙏",
  menuUnavailable: "Maazrat, abhi online menu available nahi hai. Hamara staff jald aap se raabta karega 🙏",
  blocked: (p) => `Maazrat, is number se online order nahi ho sakta.${p ? ` Order ke liye call karein: ${p}` : ""}`,
  buttons: { confirm: "Confirm ✅", change: "Change ✏️", cancel: "Cancel ❌", delivery: "Delivery 🛵", pickup: "Pickup 🛍️", cod: "Cash on delivery", card: "Card on delivery" },
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
  orderPlaced: (n) => `✅ Thank you! Your order #${n} has been sent to the restaurant. We'll message you as soon as it's confirmed.`,
  alreadyPlaced: "Your order has already been sent to the restaurant ✅ We'll message you when it's confirmed.",
  cancelled: "Okay, your order is cancelled. Message us anytime 🙂",
  fallback: "Sorry, please try again in a little while, or talk to our staff. Someone will reply to you soon 🙏",
  notUnderstood: "Sorry, I didn't get that. Could you tell me a bit more? 🙂",
  handedOff: "Our staff will reply to you shortly 🙏",
  menuUnavailable: "Sorry, our online menu isn't available right now. Our staff will contact you shortly 🙏",
  blocked: (p) => `Sorry, online ordering isn't available for this number.${p ? ` Please call us to order: ${p}` : ""}`,
  buttons: { confirm: "Confirm ✅", change: "Change ✏️", cancel: "Cancel ❌", delivery: "Delivery 🛵", pickup: "Pickup 🛍️", cod: "Cash on delivery", card: "Card on delivery" },
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
  orderPlaced: (n) => `✅ شکریہ! آپ کا آرڈر #${n} ریسٹورنٹ کو بھیج دیا گیا ہے۔ کنفرم ہوتے ہی آپ کو پیغام مل جائے گا۔`,
  alreadyPlaced: "آپ کا آرڈر پہلے ہی ریسٹورنٹ کو بھیج دیا گیا ہے ✅ کنفرم ہوتے ہی پیغام مل جائے گا۔",
  cancelled: "ٹھیک ہے، آرڈر کینسل کر دیا۔ جب چاہیں دوبارہ پیغام کریں 🙂",
  fallback: "معذرت، تھوڑی دیر میں دوبارہ کوشش کریں، یا عملے سے بات کریں۔ ہمارا عملہ جلد آپ سے رابطہ کرے گا 🙏",
  notUnderstood: "معذرت، سمجھ نہیں آیا۔ تھوڑا اور بتا دیں؟ 🙂",
  handedOff: "ہمارا عملہ جلد آپ سے بات کرے گا 🙏",
  menuUnavailable: "معذرت، ابھی آن لائن مینو دستیاب نہیں۔ ہمارا عملہ جلد آپ سے رابطہ کرے گا 🙏",
  blocked: (p) => `معذرت، اس نمبر سے آن لائن آرڈر نہیں ہو سکتا۔${p ? ` آرڈر کے لیے کال کریں: ${p}` : ""}`,
  buttons: { confirm: "کنفرم ✅", change: "تبدیلی ✏️", cancel: "کینسل ❌", delivery: "ڈیلیوری 🛵", pickup: "پک اپ 🛍️", cod: "کیش آن ڈیلیوری", card: "کارڈ آن ڈیلیوری" },
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
