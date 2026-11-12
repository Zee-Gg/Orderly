import { ORDER_STATUS_META } from "@/components/ui/status-badge";

/** Where an order came from, in report words (keys from private.report_channel). */
export const CHANNEL_LABELS: Record<string, string> = {
  bot: "WhatsApp bot",
  menu_page: "Menu page",
  whatsapp_staff: "WhatsApp (staff)",
  phone: "Phone",
  walk_in: "Walk-in",
};

export const STATUS_WORDS: Record<string, string> = Object.fromEntries(
  Object.entries(ORDER_STATUS_META).map(([k, v]) => [k, v.label]),
);
