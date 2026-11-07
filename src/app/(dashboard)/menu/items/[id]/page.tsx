import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getItemEditorData } from "@/lib/menu/queries";
import { ItemEditor } from "../item-editor";

export const metadata: Metadata = { title: "Edit item" };

async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("menu.edit", { onDenied: "redirect" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getItemEditorData(ctx, id);
  if (!data.item) notFound();
  return (
    <ItemEditor
      restaurantId={ctx.restaurant.id}
      item={data.item}
      categories={data.categories}
      groups={data.groups}
      branches={data.branches}
      canEditPrices={can(ctx.role, "prices.edit")}
    />
  );
}

export default function EditItemPage({ params }: PageProps<"/menu/items/[id]">) {
  return (
    <Suspense fallback={<SkeletonList />}>
      <EditItem params={params} />
    </Suspense>
  );
}
