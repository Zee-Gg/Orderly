import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { SkeletonList } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { WhatsAppAdmin, type AdminRestaurantRow } from "./whatsapp-admin";

export const metadata: Metadata = { title: "WhatsApp connections" };

async function Connections() {
  const user = await requireSuperAdmin();
  // Admin client after the super admin check. Never select the token column.
  const db = createAdminClient();
  const [{ data: restaurants }, { data: branches }, { data: accounts }] = await Promise.all([
    db.from("restaurants").select("id, name, slug, city").order("name"),
    db.from("branches").select("id, restaurant_id, name").eq("is_active", true).order("created_at"),
    db
      .from("whatsapp_accounts")
      .select("restaurant_id, branch_id, phone_number_id, waba_id, display_phone_number, is_active, connected_at"),
  ]);

  const rows: AdminRestaurantRow[] = (restaurants ?? []).map((r) => {
    const account = accounts?.find((a) => a.restaurant_id === r.id) ?? null;
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      city: r.city,
      branches: (branches ?? []).filter((b) => b.restaurant_id === r.id).map((b) => ({ id: b.id, name: b.name })),
      account: account
        ? {
            branchId: account.branch_id,
            phoneNumberId: account.phone_number_id,
            wabaId: account.waba_id,
            displayPhoneNumber: account.display_phone_number,
            isActive: account.is_active,
            connectedAt: account.connected_at,
          }
        : null,
    };
  });

  return (
    <SimplePage
      title="WhatsApp connections"
      subtitle={user.email ?? undefined}
      actions={
        <Link href="/admin" className="flex min-h-touch items-center gap-1 px-2 text-sm font-semibold text-brand-700">
          <ArrowLeft aria-hidden className="size-4" /> Admin
        </Link>
      }
    >
      <WhatsAppAdmin rows={rows} />
    </SimplePage>
  );
}

export default function AdminWhatsAppPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Connections />
    </Suspense>
  );
}
