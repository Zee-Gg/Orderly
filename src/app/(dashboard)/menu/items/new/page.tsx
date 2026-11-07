import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getItemEditorData } from "@/lib/menu/queries";
import { ItemEditor } from "../item-editor";

export const metadata: Metadata = { title: "Add item" };

async function NewItem({ searchParams }: { searchParams: Promise<{ category?: string | string[] }> }) {
  const ctx = await requirePermission("menu.edit", { onDenied: "redirect" });
  const data = await getItemEditorData(ctx, null);
  if (data.categories.length === 0) redirect("/menu");
  const { category } = await searchParams;
  const wanted = typeof category === "string" ? category : undefined;
  const categoryId = data.categories.some((c) => c.id === wanted) ? wanted! : data.categories[0].id;
  return (
    <ItemEditor
      restaurantId={ctx.restaurant.id}
      item={null}
      defaultCategoryId={categoryId}
      categories={data.categories}
      groups={data.groups}
      branches={data.branches}
      canEditPrices={can(ctx.role, "prices.edit")}
    />
  );
}

export default function NewItemPage({ searchParams }: PageProps<"/menu/items/new">) {
  return (
    <Suspense fallback={<SkeletonList />}>
      <NewItem searchParams={searchParams} />
    </Suspense>
  );
}
