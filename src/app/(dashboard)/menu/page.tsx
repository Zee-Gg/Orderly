import type { Metadata } from "next";
import { Suspense } from "react";
import { MenuImageOutdatedBanner } from "@/components/bot/menu-image-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getMenuImageOutdated } from "@/lib/bot/knowledge-queries";
import { getMenuBoard } from "@/lib/menu/queries";
import { createClient } from "@/lib/supabase/server";
import { MenuBoard } from "./menu-board";

export const metadata: Metadata = { title: "Menu" };

async function Menu() {
  const ctx = await requirePermission("menu.view", { onDenied: "redirect" });
  const canBot = can(ctx.role, "bot.manage");
  const [board, outdated] = await Promise.all([
    getMenuBoard(ctx),
    canBot ? createClient().then((db) => getMenuImageOutdated(db, ctx.restaurant.id)) : false,
  ]);
  return (
    <>
      {outdated ? (
        <div className="mb-4">
          <MenuImageOutdatedBanner showLink />
        </div>
      ) : null}
      <MenuBoard
        categories={board.categories}
        items={board.items}
        branchName={ctx.currentBranch?.name ?? null}
        canEdit={can(ctx.role, "menu.edit")}
        canStock={can(ctx.role, "menu.stock")}
        canPrices={can(ctx.role, "prices.edit")}
      />
    </>
  );
}

export default function MenuPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Menu />
    </Suspense>
  );
}
