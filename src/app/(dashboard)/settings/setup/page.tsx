import type { Metadata } from "next";
import { Suspense } from "react";
import { ChecklistCard } from "@/components/onboarding/checklist-card";
import { SkeletonList } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/session";
import { getOnboardingChecklist } from "@/lib/onboarding/checklist";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Setup" };

/** Owner: getting-started checklist (auto-checked from real data). */
async function Setup() {
  const ctx = await requirePermission("settings.edit", { onDenied: "redirect" });
  const checklist = await getOnboardingChecklist(await createClient(), ctx.restaurant.id);
  return <ChecklistCard checklist={checklist} />;
}

export default function SetupPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Setup />
    </Suspense>
  );
}
