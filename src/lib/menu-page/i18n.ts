/**
 * Customer menu page texts (Phase 8). English + Urdu. Item/category names use
 * the *_ur field when there is one, else English (`pick`). Pure.
 */
export type PageLang = "en" | "ur";
export const LANG_COOKIE = "orderly_menu_lang";

/** Urdu name when we have one and the page is in Urdu; otherwise English. */
export function pick(lang: PageLang, en: string, ur: string | null | undefined): string {
  return lang === "ur" && ur && ur.trim() ? ur : en;
}

/** "Rs 1,850" / "روپے 1,850" — integer paisa in, display only. */
export function rs(paisa: number, lang: PageLang = "en"): string {
  const n = Math.round(paisa / 100).toLocaleString("en-US");
  return lang === "ur" ? `Rs ${n}` : `Rs ${n}`;
}

const EN = {
  open: "Open",
  closed: "Closed",
  deliveryTime: (a: number, b: number) => `Delivery ${a}–${b} min`,
  pickupTime: (a: number) => `Ready in ~${a} min`,
  opensAt: (t: string) => `Opens at ${t}`,
  closedToday: "Closed today",
  delivery: "Delivery",
  pickup: "Pickup",
  branch: "Branch",
  search: "Search the menu",
  noResults: "Nothing found. Try another word.",
  deals: "Today's deals",
  bestseller: "Bestseller",
  soldOut: "Sold out today",
  from: (p: string) => `from ${p}`,
  add: "Add",
  chooseSize: "Choose size",
  required: "Required",
  optional: "Optional",
  chooseExactly: (n: number) => `Choose ${n}`,
  chooseUpTo: (n: number) => `Optional · up to ${n}`,
  chooseRange: (a: number, b: number) => `Choose ${a} to ${b}`,
  removeAnything: "Remove anything?",
  free: "Free",
  no: (x: string) => `No ${x.toLowerCase()}`,
  note: "Special note",
  notePlaceholder: "e.g. Spicy rakhna",
  addToOrder: (p: string) => `Add to order — ${p}`,
  update: (p: string) => `Update — ${p}`,
  pickSize: "Please choose a size",
  pickGroup: (g: string) => `Please choose: ${g}`,
  unavailable: "Not available",
  items: (n: number): string => (n === 1 ? "item" : "items"),
  viewOrder: "View order",
  yourOrder: "Your order",
  sharesAddress: "You'll share your address in WhatsApp",
  pickupFrom: (b: string) => `Pick up from ${b}`,
  change: "Change",
  edit: "Edit",
  remove: "Remove",
  addMore: "Add more items",
  subtotal: "Subtotal",
  deliveryFee: "Delivery fee",
  feeDependsOnArea: "Delivery fee depends on your area",
  yourArea: "Your area (optional)",
  otherArea: "Other / not sure",
  feeConfirmed: "We'll confirm the fee on WhatsApp.",
  total: "Estimated total",
  minimum: (p: string) => `Minimum order for delivery is ${p}. Add a little more.`,
  finalOnWhatsApp: "Final total will be confirmed on WhatsApp.",
  send: "Send order on WhatsApp",
  sending: "Sending…",
  sendNote: "You'll confirm the order in WhatsApp — nothing is charged here.",
  closedNow: (t: string | null) => (t ? `We're closed now. ${t}.` : "We're closed now."),
  noWhatsApp: "This restaurant hasn't connected WhatsApp yet.",
  emptyCart: "Your cart is empty.",
  back: "Back",
  close: "Close",
  fixCart: "Some items changed. Please check your order.",
  tooMany: "Too many orders from this phone. Please try again later.",
  networkError: "No internet. Please try again.",
  notAvailableTitle: "This menu is not available",
  notAvailableText: "Please check the link, or message the restaurant on WhatsApp.",
  orderOnWhatsApp: "Order on WhatsApp",
  message: (code: string) => `Hi! Mera order code: ${code} 🛒`,
  msgDelivery: "(Delivery)",
  msgPickup: "(Pickup)",
};

const UR: typeof EN = {
  open: "کھلا ہے",
  closed: "بند ہے",
  deliveryTime: (a, b) => `ڈیلیوری ${a}–${b} منٹ`,
  pickupTime: (a) => `تقریباً ${a} منٹ میں تیار`,
  opensAt: (t) => `${t} بجے کھلے گا`,
  closedToday: "آج بند ہے",
  delivery: "ڈیلیوری",
  pickup: "پک اپ",
  branch: "برانچ",
  search: "مینو میں تلاش کریں",
  noResults: "کچھ نہیں ملا۔ کوئی اور لفظ آزمائیں۔",
  deals: "آج کی ڈیلز",
  bestseller: "سب سے زیادہ پسندیدہ",
  soldOut: "آج ختم ہو گیا",
  from: (p) => `${p} سے شروع`,
  add: "شامل کریں",
  chooseSize: "سائز منتخب کریں",
  required: "ضروری",
  optional: "اختیاری",
  chooseExactly: (n) => `${n} منتخب کریں`,
  chooseUpTo: (n) => `اختیاری · زیادہ سے زیادہ ${n}`,
  chooseRange: (a, b) => `${a} سے ${b} منتخب کریں`,
  removeAnything: "کچھ نکالنا ہے؟",
  free: "مفت",
  no: (x) => `${x} کے بغیر`,
  note: "خاص ہدایت",
  notePlaceholder: "مثلاً تیز مرچ",
  addToOrder: (p) => `آرڈر میں شامل کریں — ${p}`,
  update: (p) => `تبدیل کریں — ${p}`,
  pickSize: "براہ کرم سائز منتخب کریں",
  pickGroup: (g) => `براہ کرم منتخب کریں: ${g}`,
  unavailable: "دستیاب نہیں",
  items: () => "آئٹمز",
  viewOrder: "آرڈر دیکھیں",
  yourOrder: "آپ کا آرڈر",
  sharesAddress: "پتہ آپ واٹس ایپ پر بتائیں گے",
  pickupFrom: (b) => `${b} سے وصول کریں`,
  change: "تبدیل کریں",
  edit: "تبدیل",
  remove: "ہٹائیں",
  addMore: "مزید آئٹمز شامل کریں",
  subtotal: "سب ٹوٹل",
  deliveryFee: "ڈیلیوری چارجز",
  feeDependsOnArea: "ڈیلیوری چارجز آپ کے علاقے پر منحصر ہیں",
  yourArea: "آپ کا علاقہ (اختیاری)",
  otherArea: "کوئی اور / معلوم نہیں",
  feeConfirmed: "چارجز واٹس ایپ پر کنفرم ہوں گے۔",
  total: "اندازاً کل",
  minimum: (p) => `ڈیلیوری کے لیے کم از کم آرڈر ${p} ہے۔`,
  finalOnWhatsApp: "حتمی رقم واٹس ایپ پر کنفرم ہوگی۔",
  send: "واٹس ایپ پر آرڈر بھیجیں",
  sending: "بھیجا جا رہا ہے…",
  sendNote: "آرڈر آپ واٹس ایپ پر کنفرم کریں گے — یہاں کوئی رقم نہیں لی جاتی۔",
  closedNow: (t) => (t ? `ابھی بند ہے۔ ${t}۔` : "ابھی بند ہے۔"),
  noWhatsApp: "اس ریسٹورنٹ نے ابھی واٹس ایپ نہیں جوڑا۔",
  emptyCart: "آپ کا آرڈر خالی ہے۔",
  back: "واپس",
  close: "بند کریں",
  fixCart: "کچھ آئٹمز بدل گئے ہیں۔ براہ کرم آرڈر چیک کریں۔",
  tooMany: "اس فون سے بہت زیادہ آرڈر۔ تھوڑی دیر بعد کوشش کریں۔",
  networkError: "انٹرنیٹ نہیں ہے۔ دوبارہ کوشش کریں۔",
  notAvailableTitle: "یہ مینو دستیاب نہیں",
  notAvailableText: "لنک چیک کریں یا ریسٹورنٹ کو واٹس ایپ پر میسج کریں۔",
  orderOnWhatsApp: "واٹس ایپ پر آرڈر کریں",
  message: (code) => `السلام علیکم! میرا آرڈر کوڈ: ${code} 🛒`,
  msgDelivery: "(ڈیلیوری)",
  msgPickup: "(پک اپ)",
};

export function texts(lang: PageLang) {
  return lang === "ur" ? UR : EN;
}

/**
 * The pre-filled WhatsApp message. The code is what the bot reads; the list
 * is only for the customer.
 */
export function whatsappMessage(
  lang: PageLang,
  code: string,
  lines: { quantity: number; label: string }[],
  orderType: "delivery" | "pickup" | null,
): string {
  const tx = texts(lang);
  return [
    tx.message(code),
    ...lines.map((l) => `${l.quantity}x ${l.label}`),
    ...(orderType ? [orderType === "delivery" ? tx.msgDelivery : tx.msgPickup] : []),
  ].join("\n");
}

/** wa.me link with a pre-filled message (digits-only number). */
export function waLink(displayNumber: string, message: string): string | null {
  const digits = displayNumber.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
