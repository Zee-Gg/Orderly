import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/session";
import { getPriceRows } from "@/lib/menu/queries";
import { createClient } from "@/lib/supabase/server";
import { BulkPriceTool } from "./bulk-price-tool";

export const metadata: Metadata = { title: "Change prices" };

async function Prices() {
  const ctx = await requirePermission("prices.edit", { onDenied: "redirect" });
  const supabase = await createClient();
  const [rows, { data: categories }] = await Promise.all([
    getPriceRows(ctx.restaurant.id, null),
    supabase
      .from("menu_categories")
      .select("id, name")
      .eq("restaurant_id", ctx.restaurant.id)
      .is("archived_at", null)
      .order("sort_order"),
  ]);
  return <BulkPriceTool rows={rows} categories={categories ?? []} />;
}

export default function PricesPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Prices />
    </Suspense>
  );
}
