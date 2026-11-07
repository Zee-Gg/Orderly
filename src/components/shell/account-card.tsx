import Link from "next/link";
import { ArrowLeftRight, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { ShellData } from "./shell-data";

/** Signed-in person + "Switch restaurant" + "Log out". */
export function AccountCard({ data }: { data: ShellData }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-page p-2">
      <div className="flex items-center gap-3 px-1 py-1">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800"
        >
          {data.user.initials}
        </span>
        <div className="min-w-0 text-sm">
          <p className="truncate font-semibold text-ink">{data.user.name}</p>
          <p className="truncate text-muted">{ROLE_LABELS[data.role]}</p>
        </div>
      </div>
      {data.hasMultipleRestaurants ? (
        <Link
          href="/select-restaurant"
          className="flex min-h-touch items-center gap-2 rounded-control px-2 text-sm font-medium text-ink hover:bg-subtle"
        >
          <ArrowLeftRight aria-hidden className="size-4" />
          Switch restaurant
        </Link>
      ) : null}
      <form action={signOut}>
        <button
          type="submit"
          className="flex min-h-touch w-full items-center gap-2 rounded-control px-2 text-sm font-medium text-ink hover:bg-subtle"
        >
          <LogOut aria-hidden className="size-4" />
          Log out
        </button>
      </form>
    </div>
  );
}
