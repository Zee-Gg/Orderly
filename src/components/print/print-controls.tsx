"use client";

import { useEffect, useRef } from "react";
import { Printer, X } from "lucide-react";
import { recordPrintAction } from "@/lib/print/actions";

/**
 * Opens the browser print dialog once the receipt is on screen, then adds
 * a "printed" entry to the order timeline. With `preview`, shows the
 * receipt only (settings preview, tests). Hidden on paper.
 */
export function PrintControls({
  orderId,
  kind,
  preview,
}: {
  orderId: string | null;
  kind: "kot" | "bill" | "test" | "poster";
  preview: boolean;
}) {
  const done = useRef(false);

  async function print() {
    await document.fonts?.ready;
    window.print(); // blocks until the dialog closes in most browsers
    if (orderId && (kind === "kot" || kind === "bill")) void recordPrintAction(orderId, kind);
  }

  useEffect(() => {
    if (preview || done.current) return;
    done.current = true;
    // Let the page paint first so the dialog shows the receipt.
    const t = setTimeout(() => void print(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- print once on open
  }, [preview]);

  return (
    <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "center", padding: 12, background: "#f5f5f4" }}>
      <button
        type="button"
        onClick={() => void print()}
        style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 16px", borderRadius: 10, background: "#c2410c", color: "#fff", fontWeight: 700, border: 0 }}
      >
        <Printer size={18} aria-hidden /> {preview ? "Print" : "Print again"}
      </button>
      <button
        type="button"
        onClick={() => window.close()}
        style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 16px", borderRadius: 10, background: "#fff", color: "#1c1917", fontWeight: 700, border: "1px solid #d6d3d1" }}
      >
        <X size={18} aria-hidden /> Close
      </button>
    </div>
  );
}
