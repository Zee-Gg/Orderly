import type { BotLanguage } from "./types";

/**
 * Which language/script the customer wrote in. Pure, no AI.
 * Returns null when a message is too short or neutral to tell ("2 zinger",
 * "ok", "👍") so the session keeps its current language.
 */
const URDU_SCRIPT = /[؀-ۿ]/g;
const LATIN = /[a-z]/gi;

// Common Roman Urdu words (whole words only).
const ROMAN_URDU = new Set(
  (
    "hai hain ho hoga hogi tha thi kya kia kyun kaise kitna kitne kitni chahiye chaiye chahye chahiay mujhe muje mjhe hum " +
    "aap ap ap ka ki ke ko se mein main mai bhi aur or nahi nhi nahin na haan han ji jee bhai bhaiya yaar acha accha " +
    "theek thik kar karo karna kardo krdo kr de dein dena dedo do teen char paanch panch ek aik wala wali wale sath " +
    "saath bina zyada ziada kam jaldi abhi kab kahan yahan wahan ghar pass paas hoga bata batao bataen batayein " +
    "shukriya meharbani maaf mehrbani hata hatao lagao dalo daal bhejo bhej kitny walay"
  ).split(" "),
);

// Clearly English function words.
const ENGLISH = new Set(
  (
    "i i'd i'm want would like please the a an and with without can could get give me my is are what how " +
    "much many some of for to it this that have has need yes thanks thank you instead remove also make where " +
    "when your you're it's that's"
  ).split(" "),
);

export function detectLanguage(text: string): BotLanguage | null {
  const urdu = (text.match(URDU_SCRIPT) ?? []).length;
  const latin = (text.match(LATIN) ?? []).length;
  if (urdu > 0 && urdu >= latin) return "urdu";

  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  // One-word answers ("pickup", "cash", "large") don't tell us the language.
  if (words.length < 2) return null;
  let roman = 0;
  let english = 0;
  for (const w of words) {
    if (ROMAN_URDU.has(w)) roman++;
    if (ENGLISH.has(w)) english++;
  }
  if (roman === 0 && english === 0) return null;
  if (roman > english) return "roman_urdu";
  if (english > roman) return "english";
  return null;
}

export const LANGUAGE_NAMES: Record<BotLanguage, string> = {
  roman_urdu: "Roman Urdu (Urdu written in English letters)",
  english: "English",
  urdu: "Urdu (Urdu script, right to left)",
};
