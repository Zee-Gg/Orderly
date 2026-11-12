import Link from "next/link";
import { TriangleAlert } from "lucide-react";

/** Yellow notice: prices changed after the menu image/PDF was uploaded (shown on /settings/bot and /menu). */
export function MenuImageOutdatedBanner({ showLink = false }: { showLink?: boolean }) {
  return (
    <div
      role="status"
      data-testid="menu-image-outdated"
      className="flex items-start gap-3 rounded-card border border-status-awaiting-border bg-status-awaiting-bg p-3 text-sm text-status-awaiting-fg"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      <p className="flex-1">
        <strong>Your menu image may show old prices.</strong> You changed prices after uploading it. Upload a new menu image so
        customers see the right prices (the bot always charges the current prices).
        {showLink ? (
          <>
            {" "}
            <Link href="/settings/bot" className="font-semibold underline">
              Update menu images
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
