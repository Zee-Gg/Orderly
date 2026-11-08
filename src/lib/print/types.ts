import type { OrderType, PaymentMethod } from "@/lib/orders/constants";

export type PaperWidth = "80mm" | "58mm";

export type ReceiptItem = {
  quantity: number;
  name: string;
  size: string | null;
  extras: string[];
  removals: string[];
  notes: string | null;
  /** Bill only. */
  unitPrice?: number;
  lineTotal?: number;
};

/** Kitchen slip: no prices, no phone, no address. */
export type KotData = {
  orderNumber: number;
  orderType: OrderType;
  tableNumber: string | null;
  branchName: string;
  createdAt: string;
  timezone: string;
  notes: string | null;
  items: ReceiptItem[];
};

export type BillData = {
  restaurantName: string;
  branchName: string;
  address: string | null;
  phone: string | null;
  header: string | null;
  footer: string | null;
  orderNumber: number;
  orderType: OrderType;
  tableNumber: string | null;
  createdAt: string;
  timezone: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  items: ReceiptItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paid: boolean;
  notes: string | null;
};

export function parseWidth(value: unknown, fallback: PaperWidth): PaperWidth {
  if (value === "58" || value === "58mm") return "58mm";
  if (value === "80" || value === "80mm") return "80mm";
  return fallback;
}
