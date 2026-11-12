import { PermissionError, requirePermission } from "@/lib/auth/session";
import { menuPageUrlForRequest } from "@/lib/menu-page/server-links";
import { qrPng, waMeLink } from "@/lib/whatsapp/links";
import { getWhatsAppNumber } from "@/lib/whatsapp/queries";

/**
 * Download a QR code as a PNG: the "order on WhatsApp" chat (default) or,
 * with ?type=menu, the customer menu page (Phase 8).
 */
export async function GET(req: Request) {
  let ctx;
  try {
    ctx = await requirePermission("settings.view");
  } catch (err) {
    if (err instanceof PermissionError) return new Response("Forbidden", { status: 403 });
    throw err;
  }
  const menu = new URL(req.url).searchParams.get("type") === "menu";
  let link: string | null;
  if (menu) {
    link = await menuPageUrlForRequest(ctx.restaurant.slug);
  } else {
    const account = await getWhatsAppNumber(ctx.restaurant.id);
    link = account ? waMeLink(account.display_phone_number) : null;
  }
  if (!link) return new Response("WhatsApp is not connected", { status: 404 });

  const png = await qrPng(link);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${menu ? "menu" : "whatsapp"}-qr-${ctx.restaurant.slug}.png"`,
      "Cache-Control": "private, no-store",
    },
  });
}
