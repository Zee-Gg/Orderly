import { formatPKR } from "@/lib/money";
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/orders/constants";
import { formatPhone } from "@/lib/orders/phone";
import type { BillData, KotData, PaperWidth, ReceiptItem } from "@/lib/print/types";

/**
 * Thermal receipts: pure black and white, high contrast, sized in mm/pt.
 * 80mm paper prints ~72mm wide; 58mm paper ~48mm.
 */
export function ReceiptStyles({ width }: { width: PaperWidth }) {
  const content = width === "80mm" ? "72mm" : "48mm";
  const base = width === "80mm" ? "11pt" : "9.5pt";
  return (
    <style>{`
      @page { size: ${width} auto; margin: 0; }
      @media print {
        html, body { background: #fff !important; }
        .no-print { display: none !important; }
      }
      .receipt {
        width: ${content};
        padding: 3mm ${width === "80mm" ? "4mm" : "5mm"} 6mm;
        margin: 0 auto;
        background: #fff;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
        font-size: ${base};
        line-height: 1.3;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .receipt * { color: #000; }
      .r-center { text-align: center; }
      .r-big { font-size: 2.6em; font-weight: 900; line-height: 1; letter-spacing: -0.02em; }
      .r-title { font-size: 1.35em; font-weight: 800; }
      .r-strong { font-weight: 800; }
      .r-small { font-size: 0.85em; }
      .r-rule { border: 0; border-top: 1.5px dashed #000; margin: 2.5mm 0; }
      .r-solid { border: 0; border-top: 2px solid #000; margin: 2.5mm 0; }
      .r-row { display: flex; justify-content: space-between; gap: 2mm; }
      .r-row > :last-child { white-space: nowrap; text-align: right; }
      .r-item { margin: 0 0 2mm; break-inside: avoid; }
      .r-item-name { font-size: 1.15em; font-weight: 700; }
      .r-qty { font-weight: 900; }
      .r-mod { padding-left: 4mm; font-weight: 700; }
      .r-removal { padding-left: 4mm; font-weight: 900; text-transform: uppercase; }
      .r-note { padding-left: 4mm; font-style: italic; }
      .r-box { border: 2px solid #000; padding: 1.5mm 2mm; margin: 2mm 0; font-weight: 700; }
      .r-invert { background: #000; color: #fff !important; padding: 1mm 2mm; display: inline-block; font-weight: 900; }
      .r-invert * { color: #fff !important; }
      .r-total { font-size: 1.4em; font-weight: 900; }
      .r-pre { white-space: pre-line; }
      ${width === "58mm" ? `
      /* Narrow paper: name on its own line, amount right-aligned under it. */
      .r-stack { flex-direction: column; gap: 0; }
      .r-stack > :last-child { align-self: flex-end; white-space: normal; }
      .r-title { font-size: 1.25em; }
      .r-total { font-size: 1.2em; }
      ` : ""}
    `}</style>
  );
}

function when(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-PK", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function typeLine(type: KotData["orderType"], table: string | null) {
  return `${ORDER_TYPE_LABELS[type].toUpperCase()}${type === "dine_in" && table ? ` · TABLE ${table}` : ""}`;
}

function ItemLines({ item, withPrices }: { item: ReceiptItem; withPrices: boolean }) {
  return (
    <div className="r-item">
      {withPrices ? (
        <div className="r-row r-stack">
          <span className="r-item-name">
            <span className="r-qty">{item.quantity}×</span> {item.name}
            {item.size ? ` (${item.size})` : ""}
          </span>
          <span className="r-strong">{item.lineTotal !== undefined ? formatPKR(item.lineTotal) : ""}</span>
        </div>
      ) : (
        <div className="r-item-name">
          <span className="r-qty">{item.quantity}×</span> {item.name}
          {item.size ? ` (${item.size})` : ""}
        </div>
      )}
      {withPrices && item.quantity > 1 && item.unitPrice !== undefined ? (
        <div className="r-mod r-small" style={{ fontWeight: 400 }}>
          {item.quantity} × {formatPKR(item.unitPrice)}
        </div>
      ) : null}
      {item.extras.map((e) => (
        <div key={e} className="r-mod">
          + {e}
        </div>
      ))}
      {item.removals.map((r) => (
        <div key={r} className="r-removal">
          × NO {r}
        </div>
      ))}
      {item.notes ? <div className="r-note">“{item.notes}”</div> : null}
    </div>
  );
}

/** Kitchen slip (KOT). No prices. */
export function KotReceipt({ data }: { data: KotData }) {
  return (
    <div className="receipt" data-receipt="kot">
      <div className="r-center r-strong">KITCHEN · {data.branchName}</div>
      <hr className="r-solid" />
      <div className="r-center r-big">#{data.orderNumber}</div>
      <div className="r-center" style={{ marginTop: "2mm" }}>
        <span className="r-invert">{typeLine(data.orderType, data.tableNumber)}</span>
      </div>
      <div className="r-center r-small" style={{ marginTop: "1.5mm" }}>
        {when(data.createdAt, data.timezone)}
      </div>
      <hr className="r-rule" />
      {data.items.map((item, i) => (
        <ItemLines key={i} item={item} withPrices={false} />
      ))}
      {data.notes ? <div className="r-box">NOTE: {data.notes}</div> : null}
      <hr className="r-solid" />
      <div className="r-center r-small">
        {data.items.reduce((n, i) => n + i.quantity, 0)} items
      </div>
    </div>
  );
}

/** Customer bill. */
export function BillReceipt({ data }: { data: BillData }) {
  return (
    <div className="receipt" data-receipt="bill">
      <div className="r-center r-title">{data.restaurantName}</div>
      {data.branchName ? <div className="r-center">{data.branchName}</div> : null}
      {data.address ? <div className="r-center r-small">{data.address}</div> : null}
      {data.phone ? <div className="r-center r-small">Tel: {formatPhone(data.phone)}</div> : null}
      {data.header ? <div className="r-center r-small r-pre" style={{ marginTop: "1.5mm" }}>{data.header}</div> : null}
      <hr className="r-solid" />
      <div className="r-row r-stack">
        <span className="r-title">Order #{data.orderNumber}</span>
        <span className="r-strong">{typeLine(data.orderType, data.tableNumber)}</span>
      </div>
      <div className="r-small">{when(data.createdAt, data.timezone)}</div>
      {data.customerName ? <div style={{ marginTop: "1.5mm" }}>Customer: <span className="r-strong">{data.customerName}</span></div> : null}
      {data.customerPhone ? <div>Phone: {formatPhone(data.customerPhone)}</div> : null}
      {data.deliveryAddress ? <div>Address: {data.deliveryAddress}</div> : null}
      <hr className="r-rule" />
      {data.items.map((item, i) => (
        <ItemLines key={i} item={item} withPrices />
      ))}
      <hr className="r-rule" />
      <div className="r-row">
        <span>Subtotal</span>
        <span>{formatPKR(data.subtotal)}</span>
      </div>
      {data.deliveryFee ? (
        <div className="r-row">
          <span>Delivery fee</span>
          <span>{formatPKR(data.deliveryFee)}</span>
        </div>
      ) : null}
      {data.discount ? (
        <div className="r-row">
          <span>Discount</span>
          <span>−{formatPKR(data.discount)}</span>
        </div>
      ) : null}
      <hr className="r-solid" />
      <div className="r-row r-total">
        <span>TOTAL</span>
        <span>{formatPKR(data.total)}</span>
      </div>
      <hr className="r-solid" />
      <div className="r-row r-stack">
        <span>Payment</span>
        <span className="r-strong">
          {PAYMENT_METHOD_LABELS[data.paymentMethod]}
          {data.paid ? " · PAID" : ""}
        </span>
      </div>
      {data.notes ? <div className="r-box">Note: {data.notes}</div> : null}
      <hr className="r-rule" />
      <div className="r-center r-pre">{data.footer || "Thank you! Please come again."}</div>
    </div>
  );
}
