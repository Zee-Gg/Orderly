import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Bot, ChevronRight, MessageCircle, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { requireSuperAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin" };

/** Platform super admin. */
async function Admin() {
  const user = await requireSuperAdmin();
  return (
    <SimplePage title="Orderly admin" subtitle={user.email ?? undefined}>
      <Link href="/admin/whatsapp" className="block max-w-xl">
        <Card padding="lg" className="flex items-center gap-4 hover:bg-subtle">
          <MessageCircle aria-hidden className="size-6 text-whatsapp" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">WhatsApp connections</p>
            <p className="text-sm text-muted">Connect each restaurant to its WhatsApp number.</p>
          </div>
          <ChevronRight aria-hidden className="size-5 text-muted" />
        </Card>
      </Link>
      <Link href="/admin/ai-usage" className="block max-w-xl">
        <Card padding="lg" className="flex items-center gap-4 hover:bg-subtle">
          <Bot aria-hidden className="size-6 text-brand-700" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">AI usage and budgets</p>
            <p className="text-sm text-muted">Bot chats, orders, tokens and cost per restaurant.</p>
          </div>
          <ChevronRight aria-hidden className="size-5 text-muted" />
        </Card>
      </Link>
      <EmptyState
        tone="neutral"
        icon={<ShieldCheck />}
        title="More admin tools coming soon"
        description="Restaurants, trials and subscriptions will be managed here."
      />
    </SimplePage>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Admin />
    </Suspense>
  );
}
