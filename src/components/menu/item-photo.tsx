import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Square item photo, or a soft placeholder. `size` is the CSS pixel size. */
export function ItemPhoto({
  url,
  size = 64,
  muted = false,
  className,
}: {
  url: string | null | undefined;
  size?: number;
  muted?: boolean;
  className?: string;
}) {
  if (url) {
    return (
      <Image
        src={url}
        alt=""
        width={size}
        height={size}
        sizes={`${size}px`}
        className={cn("shrink-0 rounded-card object-cover", muted && "grayscale", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-card",
        muted ? "bg-subtle text-muted" : "bg-brand-50 text-brand-700",
        className,
      )}
    >
      <ImageIcon className="size-1/3" />
    </span>
  );
}
