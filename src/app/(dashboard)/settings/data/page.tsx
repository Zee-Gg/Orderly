import type { Metadata } from "next";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/session";
import { DeleteCustomer } from "./delete-customer";

export const metadata: Metadata = { title: "Data & privacy" };

/** Owner: download everything as CSV, delete a customer's personal data (Phase 12). */
async function Data() {
  await requirePermission("data.export", { onDenied: "redirect" });
  const files = [
    { type: "orders", label: "All orders", hint: "Every order with totals, customer, address and status." },
    { type: "customers", label: "Customers", hint: "Names, phone numbers, orders and total spent." },
    { type: "menu", label: "Menu", hint: "Categories, items, sizes and prices." },
  ];
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card padding="lg" className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">Download your data</h2>
          <p className="text-sm text-muted">CSV files open in Excel or Google Sheets. Keep them safe — they contain customer phone numbers.</p>
        </div>
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.type} className="flex flex-wrap items-center gap-3 rounded-control border border-line p-3">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{f.label}</span>
                <span className="block text-sm text-muted">{f.hint}</span>
              </span>
              <a href={`/api/settings/export?type=${f.type}`} download className={buttonVariants({ variant: "secondary" })}>
                <Download aria-hidden /> Download
              </a>
            </li>
          ))}
        </ul>
      </Card>
      <DeleteCustomer />
    </div>
  );
}

export default function DataPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Data />
    </Suspense>
  );
}
