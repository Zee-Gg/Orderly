import { createClient } from "@/lib/supabase/client";
import { LOGO_BUCKET } from "./logo";

/**
 * Upload from the browser straight to Storage (fast on weak connections, no
 * server hop). Storage RLS only allows owners to write into their own
 * restaurant's folder. Returns the storage path.
 */
export async function uploadLogo(restaurantId: string, file: File): Promise<string> {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${restaurantId}/logo-${Date.now()}.${ext}`;
  const { error } = await createClient()
    .storage.from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "31536000" });
  if (error) throw new Error("Couldn't upload the logo. Please try again.");
  return path;
}
