"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compressImage, uploadMenuImage } from "@/lib/menu/image-upload";
import { ItemPhoto } from "./item-photo";

/**
 * Item photo: pick → shrink in the browser → upload with a progress bar.
 * Calls onChange with the public URL ("" when removed).
 */
export function MenuImagePicker({
  restaurantId,
  value,
  onChange,
  error,
}: {
  restaurantId: string;
  value: string;
  onChange: (url: string) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState<"compressing" | "uploading" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = stage !== null;

  async function onPick(file: File) {
    setProblem(null);
    try {
      setStage("compressing");
      const blob = await compressImage(file);
      setStage("uploading");
      setProgress(0);
      const url = await uploadMenuImage(restaurantId, blob, setProgress);
      onChange(url);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setStage(null);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink">Photo</p>
      <div className="relative">
        <ItemPhoto url={value || null} size={176} className="aspect-square w-full max-w-44" />
        {busy ? (
          <div className="absolute inset-0 flex max-w-44 flex-col items-center justify-center gap-2 rounded-card bg-ink/60 p-4 text-sm font-semibold text-white">
            {stage === "compressing" ? "Preparing photo…" : `Uploading ${progress ?? 0}%`}
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full rounded-full bg-white transition-[width]"
                style={{ width: `${stage === "compressing" ? 10 : (progress ?? 0)}%` }}
                role="progressbar"
                aria-valuenow={progress ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Upload progress"
              />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex max-w-44 flex-col gap-2">
        <Button
          variant="secondary"
          icon={value ? <Upload /> : <ImagePlus />}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {value ? "Change photo" : "Add photo"}
        </Button>
        {value ? (
          <Button variant="ghost" icon={<Trash2 />} onClick={() => onChange("")} disabled={busy}>
            Remove photo
          </Button>
        ) : null}
      </div>
      {problem || error ? (
        <p className="text-sm text-danger">{problem ?? error}</p>
      ) : (
        <p className="max-w-44 text-xs text-muted">We shrink photos so they load fast on mobile data.</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onPick(file);
        }}
      />
    </div>
  );
}
