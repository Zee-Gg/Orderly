import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getMenuBoard } from "@/lib/menu/queries";
import { MenuBoard } from "./menu-board";

export const metadata: Metadata = { title: "Menu" };

async function Menu() {
  const ctx = await requirePermission("menu.view", { onDenied: "redirect" });
  const board = await getMenuBoard(ctx);
  return (
    <MenuBoard
      categories={board.categories}
      items={board.items}
      branchName={ctx.currentBranch?.name ?? null}
      canEdit={can(ctx.role, "menu.edit")}
      canStock={can(ctx.role, "menu.stock")}
      canPrices={can(ctx.role, "prices.edit")}
    />
  );
}

export default function MenuPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Menu />
    </Suspense>
  );
}
