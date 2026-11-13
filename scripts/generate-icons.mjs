/**
 * Make the app icons (PWA / Add to Home Screen) from one SVG.
 *   node scripts/generate-icons.mjs
 * Writes public/icons/*.png. Run again after changing the SVG below.
 */
import sharp from "sharp";

const BRAND = "#c2410c";
// Fork + knife (lucide "utensils" shape) in white on the brand color.
const glyph = `<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(6 6) scale(0.5)">
  <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>
</g>`;
const svg = (rounded, pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="${rounded ? 5 : 0}" fill="${BRAND}"/>
  <g transform="translate(${pad} ${pad}) scale(${(24 - 2 * pad) / 24})">${glyph}</g>
</svg>`;

const jobs = [
  ["public/icons/icon-192.png", 192, svg(true)],
  ["public/icons/icon-512.png", 512, svg(true)],
  // Maskable: full-bleed square, artwork kept inside the 80% safe zone.
  ["public/icons/icon-maskable-512.png", 512, svg(false, 2.4)],
  ["public/icons/apple-touch-icon.png", 180, svg(false)],
];
for (const [file, size, s] of jobs) {
  await sharp(Buffer.from(s)).resize(size, size).png().toFile(file);
  console.log("wrote", file);
}
