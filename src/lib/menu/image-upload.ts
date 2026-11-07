import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import { MENU_IMAGE_BUCKET, MENU_IMAGE_MAX_SIDE, MENU_IMAGE_TARGET_BYTES } from "./image-constants";

/**
 * Shrink a photo in the browser before upload: longest side ≤ 1200px, WebP,
 * lowering quality until it's under ~200 KB. A 4 MB phone photo usually
 * becomes ~100 KB — much faster on mobile data.
 */
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo (JPG, PNG or WebP).");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This photo couldn't be opened. Please try another one.");
  });
  const scale = Math.min(1, MENU_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser can't process photos.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = 0.82;
  let blob: Blob | null = null;
  while (quality >= 0.4) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (!blob) break;
    // Old browsers silently return PNG when they can't encode WebP.
    if (blob.type !== "image/webp") break;
    if (blob.size <= MENU_IMAGE_TARGET_BYTES) break;
    quality -= 0.12;
  }
  if (!blob) throw new Error("Couldn't prepare the photo. Please try again.");
  return blob;
}

/**
 * Upload with progress (0–100). supabase-js has no progress events, so this
 * posts to the Storage REST endpoint with the user's own session token;
 * storage RLS limits writes to owners/managers in their restaurant folder.
 * Returns the public URL.
 */
export async function uploadMenuImage(
  restaurantId: string,
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<string> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please log in again to upload photos.");

  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  const path = `${restaurantId}/items/${crypto.randomUUID()}.${ext}`;
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/storage/v1/object/${MENU_IMAGE_BUCKET}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("Content-Type", blob.type);
    xhr.setRequestHeader("Cache-Control", "max-age=31536000");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(xhr.status === 403 ? "You can't upload photos for this restaurant." : "Upload failed. Please try again."));
    xhr.onerror = () => reject(new Error("No internet. Please try again when you're back online."));
    xhr.send(blob);
  });

  onProgress(100);
  return `${base}/storage/v1/object/public/${MENU_IMAGE_BUCKET}/${path}`;
}
