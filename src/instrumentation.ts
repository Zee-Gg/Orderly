import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions } from "@/lib/monitoring/sentry-options";

/**
 * Server + edge error tracking (Phase 12). Off unless SENTRY_DSN is set.
 * No personal data: see src/lib/monitoring/sentry-options.ts.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, ...sentryBaseOptions });
}

export const onRequestError = Sentry.captureRequestError;
