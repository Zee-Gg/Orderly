import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { BotPlayground } from "@/components/bot/playground";
import { requireSuperAdmin } from "@/lib/auth/session";
import { activeProvider, modelFor } from "@/lib/bot/config";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Bot playground", robots: { index: false, follow: false } };

/** Development only + super admin: chat with the real order bot in the browser. */
async function Playground() {
  if (process.env.NODE_ENV === "production") notFound();
  await requireSuperAdmin();
  const db = createAdminClient();
  const [{ data: restaurants }, { data: branches }] = await Promise.all([
    db.from("restaurants").select("id, name").order("name"),
    db.from("branches").select("id, restaurant_id, name, is_open").eq("is_active", true).order("created_at"),
  ]);
  const provider = activeProvider();
  return (
    <SimplePage title="Bot playground" subtitle={`Development only · ${provider} · ${modelFor(provider)}`}>
      <BotPlayground
        restaurants={(restaurants ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          branches: (branches ?? []).filter((b) => b.restaurant_id === r.id).map((b) => ({ id: b.id, name: b.name, isOpen: b.is_open })),
        }))}
      />
    </SimplePage>
  );
}

export default function BotPlaygroundPage() {
  return (
    <Suspense fallback={<SkeletonList count={3} />}>
      <Playground />
    </Suspense>
  );
}
