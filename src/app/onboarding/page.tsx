import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { getMemberships, requireUser } from "@/lib/auth/session";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata: Metadata = { title: "Set up your restaurant" };

async function Onboarding() {
  const user = await requireUser();
  const memberships = await getMemberships();
  return (
    <OnboardingWizard
      firstName={user.profile.full_name?.split(" ")[0] ?? null}
      isAdditional={memberships.length > 0}
    />
  );
}

export default function OnboardingPage() {
  return (
    <SimplePage title="Set up your restaurant" subtitle="3 quick steps. You can change everything later.">
      <div className="mx-auto w-full max-w-xl">
        <Suspense fallback={<Skeleton className="h-[28rem] w-full" />}>
          <Onboarding />
        </Suspense>
      </div>
    </SimplePage>
  );
}
