import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getPrintSettings } from "@/lib/print/queries";
import { PrintingForm } from "./printing-form";

export const metadata: Metadata = { title: "Printing" };

async function Printing() {
  const ctx = await requirePermission("settings.view", { onDenied: "redirect" });
  const settings = await getPrintSettings(ctx.restaurant.id);
  return <PrintingForm initial={settings} canEdit={can(ctx.role, "settings.edit")} />;
}

export default function PrintingPage() {
  return (
    <Suspense fallback={<SkeletonList count={2} />}>
      <Printing />
    </Suspense>
  );
}
