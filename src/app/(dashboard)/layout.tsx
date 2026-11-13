import { Suspense } from "react";
import { redirect } from "next/navigation";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/shell/bottom-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { initialsOf, type ShellData } from "@/components/shell/shell-data";
import { TopBar } from "@/components/shell/top-bar";
import { can, DASHBOARD_ROLES, homePathForRole } from "@/lib/auth/permissions";
import { PermissionsProvider } from "@/lib/auth/permissions-context";
import { getMemberships, requireMembership } from "@/lib/auth/session";
import { getLiveSnapshot, scopeBranchIds } from "@/lib/orders/queries";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { LiveAlerts } from "@/components/orders/live-alerts";
import { OwnerNotices } from "@/components/billing/owner-notices";
import { OrdersLiveProvider } from "@/components/orders/live-provider";

async function DashboardShell({ children }: { children: React.ReactNode }) {
  const ctx = await requireMembership();
  // Kitchen and rider accounts have their own screens.
  if (!DASHBOARD_ROLES.includes(ctx.role)) redirect(homePathForRole(ctx.role));
  // Suspended (unpaid): only the notice + billing page (see requirePermission).
  if (ctx.restaurant.status === "suspended" && !ctx.user.profile.is_super_admin) redirect("/suspended");
  const [memberships, snapshot] = await Promise.all([getMemberships(), getLiveSnapshot(ctx)]);

  const name = ctx.user.profile.full_name || ctx.user.email || "You";
  const data: ShellData = {
    role: ctx.role,
    restaurant: { name: ctx.restaurant.name, logoUrl: ctx.restaurant.logo_url },
    user: { name, email: ctx.user.email, initials: initialsOf(name) },
    branches: ctx.branches.map((b) => ({ id: b.id, name: b.name })),
    currentBranchId: ctx.currentBranch?.id ?? null,
    canSwitchBranch: ctx.isRestaurantWide,
    currentBranch: ctx.currentBranch
      ? { id: ctx.currentBranch.id, name: ctx.currentBranch.name, isOpen: ctx.currentBranch.is_open }
      : null,
    canToggleOpen: can(ctx.role, "branches.toggle_open"),
    hasMultipleRestaurants: memberships.length > 1,
  };

  return (
    <PermissionsProvider role={ctx.role}>
      <OrdersLiveProvider
        initial={snapshot}
        restaurantId={ctx.restaurant.id}
        branchIds={scopeBranchIds(ctx)}
        timezone={ctx.restaurant.timezone || DEFAULT_TIMEZONE}
      >
      <div className="min-h-dvh lg:pl-sidebar">
        <Sidebar data={data} className="fixed inset-y-0 left-0 z-30 hidden lg:flex" />
        <TopBar data={data} />
        <div className="flex flex-col gap-3 px-4 pt-3 empty:hidden lg:px-8">
          <OfflineBanner />
          <LiveAlerts />
          <Suspense fallback={null}>
            <OwnerNotices ctx={ctx} />
          </Suspense>
        </div>
        <main className="px-4 pt-6 pb-[calc(var(--spacing-touch-lg)+2rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-10">
          {children}
        </main>
        <BottomNav data={data} className="lg:hidden" />
      </div>
      </OrdersLiveProvider>
    </PermissionsProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:pl-sidebar">
      <div className="fixed inset-y-0 left-0 hidden w-sidebar flex-col gap-6 border-r border-line bg-surface px-4 py-6 lg:flex">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-touch w-full" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-40" />
        ))}
      </div>
      <div className="border-b border-line bg-surface px-4 py-4 lg:px-8">
        <Skeleton className="h-14 w-full max-w-96" />
      </div>
      <div className="px-4 pt-6 lg:px-8">
        <Skeleton className="mb-6 h-8 w-40" />
        <SkeletonList />
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
