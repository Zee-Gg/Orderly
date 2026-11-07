import type { ReactNode } from "react";
import type { Action } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

/**
 * Server-side page guard. Renders children only if the current member has
 * `action`; otherwise redirects to their home page. Render inside <Suspense>.
 */
export async function PermissionGate({ action, children }: { action: Action; children: ReactNode }) {
  await requirePermission(action, { onDenied: "redirect" });
  return <>{children}</>;
}
