import type { Metadata } from "next";

export const metadata: Metadata = { title: "Print", robots: { index: false, follow: false } };

/** Bare white page for receipts (no dashboard shell). */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#fff", minHeight: "100dvh" }}>{children}</div>;
}
