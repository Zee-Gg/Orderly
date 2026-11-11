import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { BotPlayground } from "@/components/bot/playground";
import { requireSuperAdmin } from "@/lib/auth/session";
import { activeProvider, modelFor } from "@/lib/bot/config";
import { devToolsEnabled } from "@/lib/bot/playground-shared";
import { availableTranscribeProviders, resolveTranscriber } from "@/lib/bot/transcribe";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Bot playground", robots: { index: false, follow: false } };

/** Development only + super admin: chat with the real order bot in the browser. */
async function Playground() {
  await connection(); // decide per request, never at build time
  if (!devToolsEnabled()) notFound();
  await requireSuperAdmin();
  const db = createAdminClient();
  const [{ data: restaurants }, { data: branches }] = await Promise.all([
    db.from("restaurants").select("id, name").order("name"),
    db.from("branches").select("id, restaurant_id, name, is_open").eq("is_active", true).order("created_at"),
  ]);
  const provider = activeProvider();
  const voiceProviders = availableTranscribeProviders();
  const voiceNote = voiceProviders.includes("groq") ? null : resolveTranscriber("groq").note;
  return (
    <SimplePage title="Bot playground" subtitle={`Development only · ${provider} · ${modelFor(provider)}`}>
      <BotPlayground
        voiceProviders={voiceProviders}
        voiceNote={voiceNote}
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
