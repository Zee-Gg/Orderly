import type { MetadataRoute } from "next";

/**
 * Installable app (Phase 12, basic): staff can "Add to Home Screen" for the
 * dashboard, kitchen and rider pages. Starts at the post-login router, which
 * sends each role to its own screen. No offline data caching.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Orderly — restaurant orders",
    short_name: "Orderly",
    description: "WhatsApp orders, kitchen screen and deliveries for your restaurant.",
    start_url: "/auth/continue",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fafaf9",
    theme_color: "#c2410c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
