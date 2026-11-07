"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Utensils, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoFileProblem } from "@/lib/restaurants/logo";

export type LogoPickerProps = {
  /** Current saved logo URL (settings), shown until a new file is picked. */
  currentUrl?: string | null;
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
};

/** Pick a logo image with a preview. Uploading is up to the parent. */
export function LogoPicker({ currentUrl, file, onFileChange, disabled }: LogoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const shown = file ? previewUrl : currentUrl;

  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-ink">Logo (optional)</p>
      <div className="flex items-center gap-4">
        {shown ? (
          // Blob previews and storage URLs: plain <img> avoids image optimisation for local blobs.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="Logo preview" className="size-20 rounded-card border border-line object-cover" />
        ) : (
          <span aria-hidden className="flex size-20 items-center justify-center rounded-card border-2 border-dashed border-line text-muted">
            <Utensils className="size-7" />
          </span>
        )}
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            icon={<ImagePlus />}
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            {shown ? "Change logo" : "Choose logo"}
          </Button>
          {file ? (
            <Button variant="ghost" icon={<X />} onClick={() => onFileChange(null)} disabled={disabled}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <p className={error ? "mt-1.5 text-sm text-danger" : "mt-1.5 text-sm text-muted"}>
        {error ?? "PNG, JPG or WebP, under 1 MB. A square image looks best."}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (!picked) return;
          const problem = logoFileProblem(picked);
          setError(problem);
          if (!problem) onFileChange(picked);
        }}
      />
    </div>
  );
}
