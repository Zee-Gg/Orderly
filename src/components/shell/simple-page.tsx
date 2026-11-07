import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";

/**
 * Full-screen page without the dashboard shell (kitchen, rider, admin,
 * picker). Header with a title and a Log out button.
 */
export function SimplePage({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:px-8">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-ink">{title}</h1>
          {subtitle ? <p className="truncate text-sm text-muted">{subtitle}</p> : null}
        </div>
        {actions}
        <form action={signOut}>
          <button
            type="submit"
            className="flex min-h-touch items-center gap-2 rounded-control px-3 text-sm font-semibold text-ink hover:bg-subtle"
          >
            <LogOut aria-hidden className="size-4" />
            Log out
          </button>
        </form>
      </header>
      <main className="flex flex-1 flex-col gap-6 p-4 lg:p-8">{children}</main>
    </div>
  );
}
