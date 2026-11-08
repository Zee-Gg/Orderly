import QRCode from "qrcode";

/** Pre-filled first message when a customer scans the restaurant's QR code. */
export const ORDER_GREETING_TEXT = "Hi, I want to order";

/**
 * wa.me link that opens a chat with the restaurant's WhatsApp number.
 * "+92 300 1234567" / "+1 (555) 155-6437" → digits only (wa.me needs the
 * full international number without "+", spaces or dashes).
 */
export function waMeLink(displayPhoneNumber: string, text: string = ORDER_GREETING_TEXT): string | null {
  const digits = displayPhoneNumber.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// Error correction "M" survives a little dirt/creasing on a printed poster.
const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } } as const;

/** Black-and-white SVG markup (crisp at any print size). */
export function qrSvg(link: string): Promise<string> {
  return QRCode.toString(link, { ...QR_OPTIONS, type: "svg" });
}

/** PNG for download (1024px: sharp when printed or shared). */
export function qrPng(link: string): Promise<Buffer> {
  return QRCode.toBuffer(link, { ...QR_OPTIONS, type: "png", width: 1024 });
}
