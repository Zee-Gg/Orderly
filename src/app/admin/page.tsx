import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { requireSuperAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin" };

/** Platform super admin. Placeholder for a later phase. */
async function Admin() {
  const user = await requireSuperAdmin();
  return (
    <SimplePage title="Orderly admin" subtitle={user.email ?? undefined}>
      <EmptyState
        tone="neutral"
        icon={<ShieldCheck />}
        title="Admin tools coming soon"
        description="Restaurants, trials and subscriptions will be managed here."
      />
    </SimplePage>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Admin />
    </Suspense>
  );
}
