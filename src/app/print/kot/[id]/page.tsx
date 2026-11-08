import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PrintControls } from "@/components/print/print-controls";
import { KotReceipt, ReceiptStyles } from "@/components/print/receipts";
import { requirePermission } from "@/lib/auth/session";
import { getKotData, getPrintSettings } from "@/lib/print/queries";
import { parseWidth } from "@/lib/print/types";

type Search = { width?: string; preview?: string };

async function Kot({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const ctx = await requirePermission("orders.print_kot", { onDenied: "redirect" });
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const [data, settings] = await Promise.all([getKotData(ctx, id), getPrintSettings(ctx.restaurant.id)]);
  if (!data) notFound();
  const width = parseWidth(sp.width, settings.width);
  return (
    <>
      <title>{`KOT #${data.orderNumber}`}</title>
      <ReceiptStyles width={width} />
      <PrintControls orderId={id} kind="kot" preview={sp.preview === "1"} />
      <KotReceipt data={data} />
    </>
  );
}

export default function KotPrintPage({ params, searchParams }: PageProps<"/print/kot/[id]">) {
  return (
    <Suspense fallback={null}>
      <Kot params={params} searchParams={searchParams as Promise<Search>} />
    </Suspense>
  );
}
