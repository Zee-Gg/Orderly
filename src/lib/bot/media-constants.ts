/** Public bucket the bot sends from (WhatsApp fetches media by URL). Paths: {restaurant_id}/menu|offers|photos/… */
export const BOT_MEDIA_BUCKET = "bot-media";
/** Menu images: longest side after resizing in the browser (JPEG, readable on a phone). */
export const BOT_IMAGE_MAX_SIDE = 1600;
/** Menu images must end up under this (WhatsApp limit is 5 MB; small = fast on mobile data). */
export const BOT_IMAGE_MAX_BYTES = 1024 * 1024;
/** Menu PDF limit (bucket limit too). */
export const BOT_PDF_MAX_BYTES = 20 * 1024 * 1024;
/** The bot sends at most this many menu images. */
export const BOT_MAX_MENU_IMAGES = 5;
