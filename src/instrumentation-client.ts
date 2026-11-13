import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions } from "@/lib/monitoring/sentry-options";

/** Browser error tracking (Phase 12). Off unless NEXT_PUBLIC_SENTRY_DSN is set (a DSN is not a secret). */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    ...sentryBaseOptions, // errors only: no tracing, no session replay
  });
}

export function onRouterTransitionStart(...args: Parameters<typeof Sentry.captureRouterTransitionStart>) {
  if (dsn) Sentry.captureRouterTransitionStart(...args);
}
