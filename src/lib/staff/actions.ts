"use server";

import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  addStaffSchema,
  updateMemberSchema,
  type AddStaffInput,
  type UpdateMemberInput,
} from "@/lib/validation/restaurant";

/**
 * Owner adds a staff account with a temporary password.
 * The auth user is created with the admin client (server only); the
 * membership is inserted as the owner, so RLS still decides it's allowed.
 * The person must change the password at first login.
 */
export async function addStaff(input: AddStaffInput): Promise<ActionResult<{ email: string }>> {
  try {
    const ctx = await requirePermission("staff.manage");
    const parsed = addStaffSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;

    const branchId = v.branchId === "all" ? null : v.branchId;
    if (branchId && !ctx.branches.some((b) => b.id === branchId)) {
      return { ok: false, error: "That branch isn't available.", fieldErrors: { branchId: "Choose a branch" } };
    }

    const admin = createAdminClient();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: v.email,
      password: v.tempPassword,
      email_confirm: true,
      user_metadata: { full_name: v.fullName },
    });
    if (createError || !created.user) {
      const msg = createError?.message.toLowerCase() ?? "";
      if (createError?.code === "email_exists" || msg.includes("already")) {
        return {
          ok: false,
          error: "This email already has an Orderly account.",
          fieldErrors: { email: "Already has an account. Use a different email." },
        };
      }
      if (createError?.code === "weak_password" || msg.includes("password")) {
        return {
          ok: false,
          error: "Please choose a stronger temporary password.",
          fieldErrors: { tempPassword: "Too weak. Mix letters and numbers." },
        };
      }
      throw createError ?? new Error("createUser returned no user");
    }
    const userId = created.user.id;

    const { error: profileError } = await admin
      .from("profiles")
      .update({ full_name: v.fullName, must_change_password: true })
      .eq("id", userId);

    const supabase = await createClient();
    const { data: membership, error: memberError } = profileError
      ? { data: null, error: profileError }
      : await supabase
          .from("memberships")
          .insert({ user_id: userId, restaurant_id: ctx.restaurant.id, branch_id: branchId, role: v.role })
          .select("id")
          .single();

    if (memberError || !membership) {
      // Don't leave an orphan login behind.
      await admin.auth.admin.deleteUser(userId);
      throw memberError ?? new Error("membership insert failed");
    }

    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "staff.added",
      entityType: "membership",
      entityId: membership.id,
      newData: { user_id: userId, name: v.fullName, email: v.email, role: v.role, branch_id: branchId },
    });
    revalidatePath("/settings/staff");
    return { ok: true, data: { email: v.email } };
  } catch (err) {
    return failure(err, "Couldn't add this person. Please try again.");
  }
}

/** Owner changes someone's role, branch, or active status. */
export async function updateMember(input: UpdateMemberInput): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("staff.manage");
    const parsed = updateMemberSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;

    const supabase = await createClient();
    const { data: before } = await supabase
      .from("memberships")
      .select("id, user_id, role, branch_id, is_active")
      .eq("id", v.membershipId)
      .eq("restaurant_id", ctx.restaurant.id)
      .single();
    if (!before) return { ok: false, error: "This person isn't in your restaurant." };
    if (before.user_id === ctx.user.id) {
      return { ok: false, error: "You can't change your own role or deactivate yourself." };
    }
    if (before.role === "owner") return { ok: false, error: "The owner's access can't be changed." };

    const branchId = v.branchId === "all" ? null : v.branchId;
    if (branchId && !ctx.branches.some((b) => b.id === branchId)) {
      return { ok: false, error: "That branch isn't available.", fieldErrors: { branchId: "Choose a branch" } };
    }

    const { data, error } = await supabase
      .from("memberships")
      .update({ role: v.role, branch_id: branchId, is_active: v.isActive })
      .eq("id", before.id)
      .select("id");
    if (error) throw error;
    if (!data.length) return { ok: false, error: "You can't change this person's access." };

    const base = { restaurantId: ctx.restaurant.id, userId: ctx.user.id, entityType: "membership", entityId: before.id };
    if (before.role !== v.role) {
      await writeAuditLog(supabase, {
        ...base,
        action: "staff.role_changed",
        oldData: { role: before.role },
        newData: { role: v.role },
      });
    }
    if (before.branch_id !== branchId) {
      await writeAuditLog(supabase, {
        ...base,
        action: "staff.branch_changed",
        oldData: { branch_id: before.branch_id },
        newData: { branch_id: branchId },
      });
    }
    if (before.is_active !== v.isActive) {
      await writeAuditLog(supabase, {
        ...base,
        action: v.isActive ? "staff.reactivated" : "staff.deactivated",
        oldData: { is_active: before.is_active },
        newData: { is_active: v.isActive },
      });
    }
    revalidatePath("/settings/staff");
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save. Please try again.");
  }
}
