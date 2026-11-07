import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Flame } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Kitchen" };

/** Full-screen kitchen display (tablet). Placeholder for a later phase. */
export default function KitchenPage() {
  return (
    <main className="flex min-h-dvh flex-col gap-6 p-4 lg:p-8">
      <Link
        href="/orders"
        className={buttonVariants({ variant: "secondary", className: "self-start" })}
      >
        <ArrowLeft aria-hidden />
        Back to orders
      </Link>
      <EmptyState
        icon={<Flame />}
        title="Kitchen screen"
        description="Accepted orders will appear here in big cards for the cooks, with one tap to mark them ready."
        className="flex-1 justify-center"
      />
    </main>
  );
}
