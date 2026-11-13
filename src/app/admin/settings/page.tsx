import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { SimplePage } from "@/components/shell/simple-page";
import { SkeletonList } from "@/components/ui/skeleton";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getPlatformSettings, listPlans } from "@/lib/billing/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { PlatformSettingsForm, PlansEditor } from "./settings-forms";

export const metadata: Metadata = { title: "Plans & settings" };

/** Super admin: trial/grace days, how to pay, sales WhatsApp, and the plans. */
async function Settings() {
  await requireSuperAdmin();
  const db = createAdminClient();
  const [settings, plans] = await Promise.all([getPlatformSettings(db), listPlans(db, { activeOnly: false })]);
  return (
    <SimplePage title="Plans & settings" subtitle="Platform-wide">
      <AdminNav />
      <div className="grid gap-4 xl:grid-cols-2">
        <PlatformSettingsForm settings={settings} />
        <PlansEditor plans={plans} />
      </div>
    </SimplePage>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Settings />
    </Suspense>
  );
}
