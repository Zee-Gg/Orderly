import { Suspense } from "react";
import { PrintControls } from "@/components/print/print-controls";
import { BillReceipt, KotReceipt, ReceiptStyles } from "@/components/print/receipts";
import { requirePermission } from "@/lib/auth/session";
import { getPrintSettings } from "@/lib/print/queries";
import { parseWidth } from "@/lib/print/types";
import { DEFAULT_TIMEZONE } from "@/lib/time";

type Search = { width?: string; preview?: string };

/** "Print test slip": sample KOT + bill with this restaurant's settings. */
async function TestSlip({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requirePermission("orders.print_kot", { onDenied: "redirect" });
  const [sp, settings] = await Promise.all([searchParams, getPrintSettings(ctx.restaurant.id)]);
  const width = parseWidth(sp.width, settings.width);
  const now = new Date().toISOString();
  const tz = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
  const items = [
    { quantity: 1, name: "Chicken Tikka Pizza", size: "Large", extras: ["Extra Cheese"], removals: ["Olives"], notes: "Well done", unitPrice: 200000, lineTotal: 200000 },
    { quantity: 2, name: "Garlic Naan", size: null, extras: [], removals: [], notes: null, unitPrice: 12000, lineTotal: 24000 },
  ];
  return (
    <>
      <title>Test slip</title>
      <ReceiptStyles width={width} />
      <PrintControls orderId={null} kind="test" preview={sp.preview === "1"} />
      <KotReceipt
        data={{
          orderNumber: 1234,
          orderType: "dine_in",
          tableNumber: "5",
          branchName: ctx.currentBranch?.name ?? ctx.branches[0]?.name ?? "",
          createdAt: now,
          timezone: tz,
          notes: "TEST SLIP — printer is working",
          items: items.map((i) => ({ ...i, unitPrice: undefined, lineTotal: undefined })),
        }}
      />
      <div style={{ breakBefore: "page" }} />
      <BillReceipt
        data={{
          restaurantName: ctx.restaurant.name,
          branchName: ctx.currentBranch?.name ?? ctx.branches[0]?.name ?? "",
          address: null,
          phone: ctx.restaurant.phone,
          header: settings.header,
          footer: settings.footer,
          orderNumber: 1234,
          orderType: "dine_in",
          tableNumber: "5",
          createdAt: now,
          timezone: tz,
          customerName: "Test Customer",
          customerPhone: null,
          deliveryAddress: null,
          items,
          subtotal: 224000,
          deliveryFee: 0,
          discount: 0,
          total: 224000,
          paymentMethod: "cod",
          paid: false,
          notes: null,
        }}
      />
    </>
  );
}

export default function TestPrintPage({ searchParams }: PageProps<"/print/test">) {
  return (
    <Suspense fallback={null}>
      <TestSlip searchParams={searchParams as Promise<Search>} />
    </Suspense>
  );
}
