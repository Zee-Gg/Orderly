import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getGroupLibrary } from "@/lib/menu/queries";
import { ExtrasLibrary } from "./extras-library";

export const metadata: Metadata = { title: "Extras" };

async function Extras() {
  const ctx = await requirePermission("menu.view", { onDenied: "redirect" });
  const groups = await getGroupLibrary(ctx.restaurant.id);
  return <ExtrasLibrary groups={groups} canEdit={can(ctx.role, "menu.edit")} />;
}

export default function ExtrasPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Extras />
    </Suspense>
  );
}
