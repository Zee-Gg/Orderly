import "server-only";
import { after } from "next/server";
import { sendOrderUpdate } from "@/lib/whatsapp/order-updates";
import { whatsappDeps } from "@/lib/whatsapp/server";
import { setOrderEventHandler } from "./events";

/**
 * Plugs WhatsApp order status messages into emitOrderEvent. Imported once by
 * the order server actions. The send runs in `after()`: the staff action
 * returns first, and a slow or failing WhatsApp never affects the order.
 */
setOrderEventHandler(
  async (order, event) => {
    const result = await sendOrderUpdate(whatsappDeps(), order, event);
    if (result.sent || result.reason !== "no message for this change") {
      console.log(
        "[whatsapp] order update",
        JSON.stringify({ orderId: order.id, to: event.to, ...(result.sent ? { sent: true } : { sent: false, reason: result.reason }) }),
      );
    }
  },
  (task) => {
    try {
      after(task);
    } catch {
      void task(); // outside a request (shouldn't happen): still never block
    }
  },
);
