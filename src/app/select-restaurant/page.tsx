import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, Plus, Utensils } from "lucide-react";
import { SkeletonList } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { selectRestaurant } from "@/lib/auth/selection-actions";
import { getMemberships, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Choose restaurant" };

async function RestaurantList() {
  await requireUser();
  const memberships = await getMemberships();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
      <p className="text-base text-muted">You work at more than one restaurant. Which one now?</p>
      {memberships.map((m) => (
        <form key={m.id} action={selectRestaurant.bind(null, m.restaurant_id)}>
          <button
            type="submit"
            className="flex min-h-touch-lg w-full items-center gap-3 rounded-card border border-line bg-surface p-4 text-left shadow-card hover:border-brand-700"
          >
            <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-card bg-brand-700 text-white">
              <Utensils className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-bold">{m.restaurant.name}</span>
              <span className="block text-sm text-muted">{ROLE_LABELS[m.role]}</span>
            </span>
            <ChevronRight aria-hidden className="size-5 text-muted" />
          </button>
        </form>
      ))}
      <Link
        href="/onboarding"
        className="flex min-h-touch items-center justify-center gap-2 rounded-card border-2 border-dashed border-line p-3 text-sm font-semibold text-brand-700"
      >
        <Plus aria-hidden className="size-4" />
        Add another restaurant
      </Link>
    </div>
  );
}

export default function SelectRestaurantPage() {
  return (
    <SimplePage title="Choose restaurant">
      <Suspense fallback={<SkeletonList />}>
        <RestaurantList />
      </Suspense>
    </SimplePage>
  );
}
