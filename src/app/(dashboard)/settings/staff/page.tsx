import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { StaffManager, type StaffRow } from "./staff-manager";

export const metadata: Metadata = { title: "Staff" };

async function Staff() {
  const ctx = await requirePermission("staff.view", { onDenied: "redirect" });
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("id, user_id, role, branch_id, is_active, profile:profiles(full_name)")
    .eq("restaurant_id", ctx.restaurant.id)
    .order("created_at");
  const members = data ?? [];

  // Emails live in auth.users, which RLS can't expose. Look up only the
  // people RLS already returned, after the permission check above.
  const admin = createAdminClient();
  const emails = new Map(
    await Promise.all(
      members.map(async (m) => {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        return [m.user_id, u.user?.email ?? null] as const;
      }),
    ),
  );

  const rows: StaffRow[] = members.map((m) => ({
    membershipId: m.id,
    userId: m.user_id,
    name: m.profile?.full_name || "No name",
    email: emails.get(m.user_id) ?? null,
    role: m.role,
    branchId: m.branch_id,
    isActive: m.is_active,
    isYou: m.user_id === ctx.user.id,
  }));

  return (
    <StaffManager
      staff={rows}
      branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
      canManage={can(ctx.role, "staff.manage")}
    />
  );
}

export default function StaffPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Staff />
    </Suspense>
  );
}
