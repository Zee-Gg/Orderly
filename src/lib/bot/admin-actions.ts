"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  restaurantId: z.uuid(),
  // USD per month (AI provider cost, not restaurant money). null = no limit.
  budgetUsd: z.number().min(0, "Can't be negative").max(100_000, "Too high").multipleOf(0.01, "Use cents at most").nullable(),
});

/** Super admin: monthly AI budget for a restaurant. Over budget → new chats go to staff. */
export async function setAiBudgetAction(input: z.input<typeof schema>): Promise<ActionResult> {
  try {
    const user = await requireSuperAdmin();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const db = createAdminClient();
    const { data, error } = await db
      .from("restaurants")
      .update({ ai_monthly_budget_usd: parsed.data.budgetUsd })
      .eq("id", parsed.data.restaurantId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Restaurant not found." };
    await writeAuditLog(db, {
      restaurantId: parsed.data.restaurantId,
      userId: user.id,
      action: "bot.budget_changed",
      entityType: "restaurant",
      entityId: parsed.data.restaurantId,
      newData: { ai_monthly_budget_usd: parsed.data.budgetUsd },
    });
    revalidatePath("/admin/ai-usage");
    return { ok: true, message: "Budget saved" };
  } catch (err) {
    return failure(err, "Couldn't save the budget.");
  }
}
