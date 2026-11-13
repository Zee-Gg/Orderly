import type { ErrorEvent } from "@sentry/nextjs";
import { scrubText, scrubValue } from "./scrub";

/**
 * Shared Sentry settings: errors only (no tracing, no replays), no personal
 * data. Every event passes through beforeSend, which drops user/request
 * details and masks phones, emails and tokens in messages and stack frames.
 */
export function beforeSend(event: ErrorEvent): ErrorEvent | null {
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    if (event.request.query_string) event.request.query_string = "[redacted]";
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
  }
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars;
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({ ...b, message: b.message ? scrubText(b.message) : b.message, data: b.data ? (scrubValue(b.data) as Record<string, unknown>) : b.data }));
  }
  return event;
}

export const sentryBaseOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  beforeSend,
};
