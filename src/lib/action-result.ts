import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";

/** What every server action returns to its form. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** First error message per field, keyed by the dotted path. */
export function zodFailure(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
}

/**
 * Turn an unexpected error into a friendly result. Re-throws Next.js control
 * flow (redirect/notFound) so those still work inside try/catch.
 */
export function failure(err: unknown, fallback = "Something went wrong. Please try again."): ActionResult<never> {
  unstable_rethrow(err);
  if (err instanceof Error && err.name === "PermissionError") {
    return { ok: false, error: "You don't have permission to do this." };
  }
  console.error(err);
  return { ok: false, error: fallback };
}
