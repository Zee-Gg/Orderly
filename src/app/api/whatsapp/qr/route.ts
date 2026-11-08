import { PermissionError, requirePermission } from "@/lib/auth/session";
import { qrPng, waMeLink } from "@/lib/whatsapp/links";
import { getWhatsAppNumber } from "@/lib/whatsapp/queries";

/** Download the restaurant's "order on WhatsApp" QR code as a PNG. */
export async function GET() {
  let ctx;
  try {
    ctx = await requirePermission("settings.view");
  } catch (err) {
    if (err instanceof PermissionError) return new Response("Forbidden", { status: 403 });
    throw err;
  }
  const account = await getWhatsAppNumber(ctx.restaurant.id);
  const link = account ? waMeLink(account.display_phone_number) : null;
  if (!link) return new Response("WhatsApp is not connected", { status: 404 });

  const png = await qrPng(link);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="whatsapp-qr-${ctx.restaurant.slug}.png"`,
      "Cache-Control": "private, no-store",
    },
  });
}
