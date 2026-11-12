import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import { BOT_IMAGE_MAX_BYTES, BOT_IMAGE_MAX_SIDE, BOT_MEDIA_BUCKET, BOT_PDF_MAX_BYTES } from "./media-constants";

/**
 * Browser side of /settings/bot uploads. Menu images become JPEG (WhatsApp
 * only takes JPEG/PNG), longest side ≤ 1600px so prices stay readable, and
 * under 1 MB. PDFs are uploaded as they are (≤ 20 MB).
 */
export async function compressMenuImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo (JPG, PNG or WebP) or a PDF.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This photo couldn't be opened. Please try another one.");
  });
  let side = Math.min(BOT_IMAGE_MAX_SIDE, Math.max(bitmap.width, bitmap.height));
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = side / Math.max(bitmap.width, bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser can't process photos.");
      // JPEG has no transparency: white background, like paper.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (let quality = 0.85; quality >= 0.55; quality -= 0.1) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob) throw new Error("Couldn't prepare the photo. Please try again.");
        if (blob.size <= BOT_IMAGE_MAX_BYTES) return blob;
      }
      side = Math.round(side * 0.8); // still too big: a bit smaller
    }
  } finally {
    bitmap.close();
  }
  throw new Error("This image is too detailed to make small enough. Try a smaller photo.");
}

/**
 * Upload with progress (0–100) to bot-media/{restaurantId}/menu/… with the
 * user's own token (storage RLS: owner/manager, own folder). Returns the path.
 */
export async function uploadBotMedia(
  restaurantId: string,
  blob: Blob,
  kind: "image" | "pdf",
  onProgress: (percent: number) => void,
): Promise<string> {
  if (kind === "pdf" && blob.size > BOT_PDF_MAX_BYTES) throw new Error("The PDF is bigger than 20 MB. Please make it smaller.");
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please log in again to upload.");

  const ext = kind === "pdf" ? "pdf" : blob.type === "image/png" ? "png" : "jpg";
  const contentType = kind === "pdf" ? "application/pdf" : blob.type || "image/jpeg";
  const path = `${restaurantId}/menu/${crypto.randomUUID()}.${ext}`;
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/storage/v1/object/${BOT_MEDIA_BUCKET}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("Cache-Control", "max-age=31536000");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(xhr.status === 403 ? "You can't upload files for this restaurant." : "Upload failed. Please try again."));
    xhr.onerror = () => reject(new Error("No internet. Please try again when you're back online."));
    xhr.send(blob);
  });
  onProgress(100);
  return path;
}
