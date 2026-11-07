export const LOGO_BUCKET = "restaurant-logos";
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Friendly problem with a picked file, or null if it's fine. */
export function logoFileProblem(file: File): string | null {
  if (!LOGO_TYPES.includes(file.type)) return "Please choose a PNG, JPG or WebP image.";
  if (file.size > LOGO_MAX_BYTES) return "This image is too big. Please choose one under 1 MB.";
  return null;
}
