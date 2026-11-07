"use client";

import { createContext, use, type ReactNode } from "react";
import { can, type Action, type Role } from "./permissions";

const RoleContext = createContext<Role | null>(null);

/** Provided by the dashboard shell with the verified role from the server. */
export function PermissionsProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext value={role}>{children}</RoleContext>;
}

/**
 * UI-only check to hide buttons a user can't use.
 * The server still enforces every action with requirePermission() + RLS.
 */
export function usePermission(action: Action): boolean {
  return can(use(RoleContext), action);
}

export function useRole(): Role | null {
  return use(RoleContext);
}
