import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

async function SettingsHome(): Promise<null> {
  const ctx = await requirePermission("settings.view", { onDenied: "redirect" });
  redirect(can(ctx.role, "settings.edit") ? "/settings/restaurant" : "/settings/branches");
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <SettingsHome />
    </Suspense>
  );
}
