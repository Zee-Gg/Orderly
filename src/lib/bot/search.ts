import type { BranchMenu, BranchMenuItem } from "@/lib/menu/pricing";

/**
 * Fuzzy menu search for the bot. Pure (no DB, no AI): it searches the branch
 * menu from getBranchMenu(), so archived/hidden items are already gone.
 *
 * Handles misspellings and Roman Urdu with three cheap signals per word:
 * trigram similarity (like pg_trgm), edit distance, and a "consonant
 * skeleton" ("zngr" = "zinger", "piza" = "pizza"). Item names, Urdu names,
 * "Other names customers use" (aliases) and category names are all searched.
 */

// Quantity words, filler and order words that are never part of an item name.
const NOISE = new Set(
  (
    "ek aik 1 do 2 teen 3 char chaar 4 paanch panch 5 chay chhe 6 saat 7 one two three four five six seven eight nine ten " +
    "a an the and aur or with without please plz pls bhai bhaiya yaar ji jee mujhe muje chahiye chaiye chahye want need " +
    "i me give get order add some de do dena dedo karo kar dein bhej bhejo send x pcs piece pieces wala wali wale " +
    "aik se ka ki ke ko mein main"
  ).split(" "),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟ‌‍]/g, "") // Urdu diacritics, zero-width joiners
    .replace(/[̀-ͯ]/g, "") // Latin accents (jalapeños → jalapenos)
    .replace(/[^a-z0-9؀-ۿ\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

/** "pizza" → "piza", "biriyani" stays: collapse doubled letters. */
const squeeze = (t: string) => t.replace(/(.)\1+/g, "$1");
/** Consonant skeleton: "zinger" → "zngr", "biryani" → "brn". */
const skeleton = (t: string) => squeeze(t).replace(/(?!^)[aeiouy]/g, "");

function trigrams(t: string): Set<string> {
  const s = `  ${t} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const g of ta) if (tb.has(g)) shared++;
  return shared / (ta.size + tb.size - shared);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** How well one query word matches one name word (0..1). */
export function wordScore(q: string, w: string): number {
  if (q === w) return 1;
  if (squeeze(q) === squeeze(w)) return 0.95;
  if (q.length >= 3 && w.startsWith(q)) return 0.85;
  if (q.length >= 3 && skeleton(q) === skeleton(w) && skeleton(q).length >= 2) return 0.85;
  const maxLen = Math.max(q.length, w.length);
  const editRatio = maxLen >= 4 ? 1 - editDistance(squeeze(q), squeeze(w)) / maxLen : 0;
  return Math.max(editRatio >= 0.6 ? editRatio * 0.9 : 0, trigramSimilarity(q, w) >= 0.4 ? trigramSimilarity(q, w) * 0.9 : 0);
}

type Indexed = { item: BranchMenuItem; category: string; names: string[][]; categoryWords: string[] };

function index(menu: BranchMenu): Indexed[] {
  return menu.categories.flatMap((c) =>
    c.items.map((item) => ({
      item,
      category: c.name,
      names: [item.name, item.nameUr ?? "", ...item.aliases].filter(Boolean).map(tokens),
      categoryWords: [...tokens(c.name), ...tokens(c.nameUr ?? "")],
    })),
  );
}

/** Best score of a query word against any word of a name. */
const bestIn = (q: string, words: string[]) => words.reduce((m, w) => Math.max(m, wordScore(q, w)), 0);

export type SearchHit = { item: BranchMenuItem; category: string; score: number };

export function searchMenu(menu: BranchMenu, query: string, limit = 5): SearchHit[] {
  const all = index(menu);
  const words = tokens(query).filter((t) => !NOISE.has(t) && !/^\d+$/.test(t));
  if (words.length === 0) return [];

  // Drop words that match nothing anywhere ("large", "spicy", "jaldi"): they
  // describe the order, they don't name an item.
  const useful = words.filter((q) =>
    all.some((x) => x.names.some((n) => bestIn(q, n) >= 0.6) || bestIn(q, x.categoryWords) >= 0.6),
  );
  if (useful.length === 0) return [];
  const phrase = useful.join(" ");

  const hits: SearchHit[] = [];
  for (const x of all) {
    let score = 0;
    for (const name of x.names) {
      if (name.join(" ") === phrase) {
        score = 1;
        break;
      }
      // Average of each query word's best match in this name, slightly
      // preferring names that are fully covered (fewer extra words).
      const avg = useful.reduce((s, q) => s + bestIn(q, name), 0) / useful.length;
      const coverage = Math.min(1, useful.length / name.length);
      score = Math.max(score, avg * (0.9 + 0.1 * coverage));
    }
    // "drinks", "pizza" → every item in that category is a reasonable match.
    const cat = useful.reduce((s, q) => s + bestIn(q, x.categoryWords), 0) / useful.length;
    score = Math.max(score, cat * 0.8);
    if (score >= 0.55) hits.push({ item: x.item, category: x.category, score: Math.round(score * 100) / 100 });
  }
  return hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, limit);
}
