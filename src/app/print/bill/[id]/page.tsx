import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PrintControls } from "@/components/print/print-controls";
import { BillReceipt, ReceiptStyles } from "@/components/print/receipts";
import { requirePermission } from "@/lib/auth/session";
import { getBillData, getPrintSettings } from "@/lib/print/queries";
import { parseWidth } from "@/lib/print/types";

type Search = { width?: string; preview?: string };

async function Bill({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const ctx = await requirePermission("orders.print_bill", { onDenied: "redirect" });
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const [data, settings] = await Promise.all([getBillData(ctx, id), getPrintSettings(ctx.restaurant.id)]);
  if (!data) notFound();
  const width = parseWidth(sp.width, settings.width);
  return (
    <>
      <title>{`Bill #${data.orderNumber}`}</title>
      <ReceiptStyles width={width} />
      <PrintControls orderId={id} kind="bill" preview={sp.preview === "1"} />
      <BillReceipt data={data} />
    </>
  );
}

export default function BillPrintPage({ params, searchParams }: PageProps<"/print/bill/[id]">) {
  return (
    <Suspense fallback={null}>
      <Bill params={params} searchParams={searchParams as Promise<Search>} />
    </Suspense>
  );
}
