import type { Role } from "@/lib/auth/permissions";
import type { BranchOption } from "./branch-switcher";

/** Everything the shell needs, computed and verified on the server. */
export type ShellData = {
  role: Role;
  restaurant: { name: string; logoUrl: string | null };
  user: { name: string; email: string | null; initials: string };
  branches: BranchOption[];
  currentBranchId: string | null;
  canSwitchBranch: boolean;
  currentBranch: { id: string; name: string; isOpen: boolean } | null;
  canToggleOpen: boolean;
  hasMultipleRestaurants: boolean;
};

export function initialsOf(name: string | null | undefined, fallback = "?") {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
