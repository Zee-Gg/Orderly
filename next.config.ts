import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** Supabase project origin (REST, Storage images/audio, Realtime websocket). */
function supabaseOrigins(): { https: string; wss: string } {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return { https: u.origin, wss: `wss://${u.host}` };
  } catch {
    return { https: "https://*.supabase.co", wss: "wss://*.supabase.co" };
  }
}

/**
 * Content-Security-Policy (Phase 12). Next.js needs inline scripts/styles
 * (hydration data, next/font), so 'unsafe-inline' stays; everything else is
 * locked to our own origin + Supabase + Sentry. No one may frame the app.
 */
function contentSecurityPolicy(): string {
  const sb = supabaseOrigins();
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", sb.https],
    "media-src": ["'self'", "blob:", sb.https],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", sb.https, sb.wss, "https://*.sentry.io", ...(isDev ? ["ws:", "http://localhost:*"] : [])],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // Google sign-in goes through Supabase Auth, then Google.
    "form-action": ["'self'", sb.https, "https://accounts.google.com"],
    "manifest-src": ["'self'"],
  };
  const csp = Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
  return isDev ? csp : `${csp}; upgrade-insecure-requests`;
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone only on the dev voice tools (rule below); location for "Use my current location".
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  poweredByHeader: false,
  // Dev only: opening the dev server through an ngrok tunnel (WhatsApp testing).
  // Without this, Next.js blocks hot reload from that host and the page keeps reloading.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.io", "*.ngrok.dev"],
  images: {
    // Restaurant logos from Supabase Storage (public bucket).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The bot playground + voice tests record from the microphone (dev only).
      {
        source: "/dev/:path*",
        headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self), payment=(), usb=()" }],
      },
    ];
  },
};

export default nextConfig;
