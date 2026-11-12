import type { Metadata } from "next";
import { Suspense } from "react";
import { MessageCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getBotKnowledge } from "@/lib/bot/knowledge-queries";
import { localDate } from "@/lib/time";
import { waMeLink } from "@/lib/whatsapp/links";
import { getWhatsAppNumber } from "@/lib/whatsapp/queries";
import { BotKnowledgeTabs } from "./bot-knowledge";

export const metadata: Metadata = { title: "Bot knowledge" };

/** Owner/manager: what the WhatsApp bot can send and answer (Phase 7C). */
async function BotKnowledgeSettings({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const ctx = await requirePermission("bot.manage", { onDenied: "redirect" });
  const [data, account, { tab }] = await Promise.all([getBotKnowledge(ctx), getWhatsAppNumber(ctx.restaurant.id), searchParams]);
  const testLink = account ? waMeLink(account.display_phone_number, "menu") : null;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-muted">
          Menu images, offers, answers to common questions and your location. The bot uses only what you save here — it never
          makes up deals or answers.
        </p>
        {testLink ? (
          <a href={testLink} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary" })}>
            <MessageCircle aria-hidden className="text-whatsapp" /> Test the bot
          </a>
        ) : null}
      </div>
      <BotKnowledgeTabs
        data={data}
        restaurantId={ctx.restaurant.id}
        branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
        isRestaurantWide={ctx.isRestaurantWide}
        canEditRestaurant={can(ctx.role, "settings.edit")}
        today={localDate(new Date(), ctx.restaurant.timezone)}
        initialTab={typeof tab === "string" ? tab : undefined}
      />
    </div>
  );
}

export default function BotKnowledgePage({ searchParams }: PageProps<"/settings/bot">) {
  return (
    <Suspense fallback={<SkeletonList count={3} />}>
      <BotKnowledgeSettings searchParams={searchParams} />
    </Suspense>
  );
}
