"use server";

import { revalidatePath } from "next/cache";
import { revalidatePublicMenu } from "@/lib/menu/public-cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "./crypto";
import { getPhoneNumberInfo, getWabaPhoneNumbers, getWabaSubscribedApps, subscribeAppToWaba } from "./graph";

/**
 * Super admin only: connect a restaurant to a WhatsApp number.
 * The access token is encrypted here and never leaves the server again.
 */
const digits = (label: string) =>
  z.string().trim().regex(/^[0-9]{5,30}$/, `${label} is a long number from Meta (digits only)`);

const connectSchema = z.object({
  restaurantId: z.uuid(),
  branchId: z.uuid("Choose the branch that gets WhatsApp orders"),
  phoneNumberId: digits("Phone number ID"),
  wabaId: digits("WhatsApp Business Account ID"),
  displayPhoneNumber: z.string().trim().min(5, "Enter the WhatsApp number").max(30),
  // Optional when editing: keep the saved token.
  accessToken: z.string().trim().max(1000).optional().or(z.literal("")),
});

const fetchImpl = (input: string, init?: RequestInit) => fetch(input, init);

const WABA_HELP =
  "This is not a WhatsApp Business Account ID. In Meta → WhatsApp → API Setup, copy the number under “WhatsApp Business Account ID”.";

/**
 * Meta only sends messages to our webhook when our app is subscribed to the
 * right business account, so check the WABA ID and that the number is in it.
 */
async function checkWaba(
  wabaId: string,
  phoneNumberId: string,
  token: string,
): Promise<{ ok: true } | { ok: false; field: "wabaId" | "phoneNumberId" | null; error: string }> {
  const res = await getWabaPhoneNumbers(fetchImpl, wabaId, token);
  if (!res.ok) {
    if (res.status === null) return { ok: false, field: null, error: `Could not reach Meta: ${res.error}` };
    return { ok: false, field: "wabaId", error: res.error.includes("nonexisting field") ? WABA_HELP : `Meta said: ${res.error}` };
  }
  if (!(res.data.data ?? []).some((n) => n.id === phoneNumberId)) {
    return { ok: false, field: "phoneNumberId", error: "This phone number ID is not in that WhatsApp Business Account." };
  }
  return { ok: true };
}

function revalidate(restaurantId: string) {
  revalidatePath("/admin/whatsapp");
  revalidatePath("/settings/whatsapp");
  revalidatePublicMenu(restaurantId); // the menu page shows the WhatsApp number
}

export async function connectWhatsAppAction(
  _prev: ActionResult<{ warning?: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ warning?: string }>> {
  try {
    const user = await requireSuperAdmin();
    const parsed = connectSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const db = createAdminClient();

    const { data: branch } = await db
      .from("branches")
      .select("id")
      .eq("id", v.branchId)
      .eq("restaurant_id", v.restaurantId)
      .maybeSingle();
    if (!branch) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { branchId: "Branch not found" } };

    const { data: existing } = await db
      .from("whatsapp_accounts")
      .select("id, access_token_encrypted, phone_number_id")
      .eq("restaurant_id", v.restaurantId)
      .maybeSingle();
    if (!v.accessToken && !existing) {
      return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { accessToken: "Paste the access token" } };
    }
    const tokenEncrypted = v.accessToken ? encryptToken(v.accessToken) : existing!.access_token_encrypted;

    const waba = await checkWaba(v.wabaId, v.phoneNumberId, v.accessToken || decryptToken(tokenEncrypted));
    if (!waba.ok) {
      return waba.field
        ? { ok: false, error: "Please check the highlighted fields.", fieldErrors: { [waba.field]: waba.error } }
        : { ok: false, error: waba.error };
    }

    const row = {
      restaurant_id: v.restaurantId,
      branch_id: v.branchId,
      phone_number_id: v.phoneNumberId,
      waba_id: v.wabaId,
      display_phone_number: v.displayPhoneNumber,
      access_token_encrypted: tokenEncrypted,
      is_active: true,
      connected_at: new Date().toISOString(),
    };
    const { error } = await db.from("whatsapp_accounts").upsert(row, { onConflict: "restaurant_id" });
    if (error) {
      if (error.code === "23505") {
        return {
          ok: false,
          error: "Please check the highlighted fields.",
          fieldErrors: { phoneNumberId: "This number is already connected to another restaurant" },
        };
      }
      throw error;
    }

    // Make sure Meta sends this business account's messages to our webhook.
    const subscribed = await subscribeAppToWaba(fetchImpl, v.wabaId, decryptToken(tokenEncrypted));

    await writeAuditLog(db, {
      restaurantId: v.restaurantId,
      userId: user.id,
      action: "whatsapp.connected",
      entityType: "whatsapp_account",
      entityId: v.phoneNumberId,
      newData: {
        phone_number_id: v.phoneNumberId,
        waba_id: v.wabaId,
        display_phone_number: v.displayPhoneNumber,
        branch_id: v.branchId,
        token_changed: Boolean(v.accessToken),
      },
    });
    revalidate(v.restaurantId);
    return {
      ok: true,
      message: "WhatsApp connected.",
      data: subscribed.ok
        ? {}
        : { warning: `Saved, but messages will not arrive until Meta accepts the webhook subscription: ${subscribed.error}` },
    };
  } catch (err) {
    return failure(err, "Could not save the WhatsApp connection.");
  }
}

const testSchema = z.object({
  restaurantId: z.uuid(),
  phoneNumberId: z.string().trim().regex(/^[0-9]{5,30}$/).optional().or(z.literal("")),
  wabaId: z.string().trim().regex(/^[0-9]{5,30}$/).optional().or(z.literal("")),
  accessToken: z.string().trim().max(1000).optional().or(z.literal("")),
});

/** Calls Meta with the typed token (or the saved one) and reads the number. */
export async function testWhatsAppConnectionAction(input: {
  restaurantId: string;
  phoneNumberId?: string;
  wabaId?: string;
  accessToken?: string;
}): Promise<ActionResult<{ displayPhoneNumber?: string; verifiedName?: string; qualityRating?: string }>> {
  try {
    await requireSuperAdmin();
    const parsed = testSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Enter a valid phone number ID and WhatsApp Business Account ID first." };
    const v = parsed.data;

    let phoneNumberId = v.phoneNumberId || null;
    let wabaId = v.wabaId || null;
    let token = v.accessToken || null;
    if (!token || !phoneNumberId || !wabaId) {
      const { data: saved } = await createAdminClient()
        .from("whatsapp_accounts")
        .select("phone_number_id, waba_id, access_token_encrypted")
        .eq("restaurant_id", v.restaurantId)
        .maybeSingle();
      if (!saved) return { ok: false, error: "Enter the phone number ID and access token first." };
      phoneNumberId ??= saved.phone_number_id;
      wabaId ??= saved.waba_id;
      token ??= decryptToken(saved.access_token_encrypted);
    }

    const res = await getPhoneNumberInfo(fetchImpl, phoneNumberId, token);
    if (!res.ok) return { ok: false, error: `Meta said: ${res.error}` };
    const waba = await checkWaba(wabaId, phoneNumberId, token);
    if (!waba.ok) return { ok: false, error: waba.error };
    const apps = await getWabaSubscribedApps(fetchImpl, wabaId, token);
    const webhook = !apps.ok
      ? ` Could not check the webhook subscription: ${apps.error}`
      : (apps.data.data ?? []).length > 0
        ? " Webhook subscription is on."
        : " Webhook subscription is OFF: press Save to turn it on, or messages will not arrive.";
    return {
      ok: true,
      message: `Connected to ${res.data.verified_name ?? "WhatsApp"} (${res.data.display_phone_number ?? phoneNumberId}).${webhook}`,
      data: {
        displayPhoneNumber: res.data.display_phone_number,
        verifiedName: res.data.verified_name,
        qualityRating: res.data.quality_rating,
      },
    };
  } catch (err) {
    return failure(err, "Could not reach WhatsApp. Try again.");
  }
}

/** Removes the connection (and the stored token). Chats stay. */
export async function disconnectWhatsAppAction(restaurantId: string): Promise<ActionResult> {
  try {
    const user = await requireSuperAdmin();
    const id = z.uuid().safeParse(restaurantId);
    if (!id.success) return { ok: false, error: "Unknown restaurant." };
    const db = createAdminClient();
    const { data: removed, error } = await db
      .from("whatsapp_accounts")
      .delete()
      .eq("restaurant_id", id.data)
      .select("phone_number_id, display_phone_number")
      .maybeSingle();
    if (error) throw error;
    if (!removed) return { ok: false, error: "This restaurant is not connected." };
    await writeAuditLog(db, {
      restaurantId: id.data,
      userId: user.id,
      action: "whatsapp.disconnected",
      entityType: "whatsapp_account",
      entityId: removed.phone_number_id,
      oldData: removed,
    });
    revalidate(id.data);
    return { ok: true, message: "WhatsApp disconnected." };
  } catch (err) {
    return failure(err, "Could not disconnect.");
  }
}
