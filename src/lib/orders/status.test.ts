import { describe, expect, it } from "vitest";
import type { OrderStatus } from "./constants";
import { canEdit, canTransition, canTransitionPath, isAllowedStep, nextActions } from "./status";

describe("allowed and blocked transitions", () => {
  const allowed: [OrderStatus, OrderStatus][] = [
    ["pending_confirmation", "awaiting_acceptance"],
    ["pending_confirmation", "cancelled"],
    ["awaiting_acceptance", "accepted"],
    ["awaiting_acceptance", "cancelled"],
    ["accepted", "preparing"],
    ["accepted", "cancelled"],
    ["preparing", "ready"],
    ["preparing", "cancelled"],
    ["out_for_delivery", "delivered"],
    ["out_for_delivery", "failed"],
    ["delivered", "completed"],
  ];
  it.each(allowed)("%s → %s is allowed", (from, to) => {
    expect(isAllowedStep(from, to, "delivery")).toBe(true);
  });

  const blocked: [OrderStatus, OrderStatus][] = [
    ["awaiting_acceptance", "preparing"],
    ["awaiting_acceptance", "ready"],
    ["accepted", "ready"],
    ["preparing", "accepted"],
    ["ready", "preparing"],
    ["out_for_delivery", "cancelled"],
    ["completed", "cancelled"],
    ["cancelled", "accepted"],
    ["failed", "completed"],
    ["delivered", "cancelled"],
  ];
  it.each(blocked)("%s → %s is blocked", (from, to) => {
    expect(isAllowedStep(from, to, "delivery")).toBe(false);
  });

  it("ready goes out for delivery only for delivery orders", () => {
    expect(isAllowedStep("ready", "out_for_delivery", "delivery")).toBe(true);
    expect(isAllowedStep("ready", "out_for_delivery", "pickup")).toBe(false);
    expect(isAllowedStep("ready", "completed", "delivery")).toBe(false);
    expect(isAllowedStep("ready", "completed", "pickup")).toBe(true);
    expect(isAllowedStep("ready", "completed", "dine_in")).toBe(true);
  });

  it("Accept & start is one valid path", () => {
    expect(canTransitionPath({ from: "awaiting_acceptance", path: ["accepted", "preparing"], orderType: "pickup", role: "staff" }).ok).toBe(true);
    expect(canTransitionPath({ from: "awaiting_acceptance", path: ["accepted", "ready"], orderType: "pickup", role: "staff" }).ok).toBe(false);
  });
});

describe("role rules", () => {
  it("kitchen can only start and finish cooking", () => {
    expect(canTransition({ from: "accepted", to: "preparing", orderType: "pickup", role: "kitchen" }).ok).toBe(true);
    expect(canTransition({ from: "preparing", to: "ready", orderType: "pickup", role: "kitchen" }).ok).toBe(true);
    expect(canTransition({ from: "awaiting_acceptance", to: "accepted", orderType: "pickup", role: "kitchen" }).ok).toBe(false);
    expect(canTransition({ from: "accepted", to: "cancelled", orderType: "pickup", role: "kitchen" }).ok).toBe(false);
    expect(canTransition({ from: "ready", to: "completed", orderType: "pickup", role: "kitchen" }).ok).toBe(false);
  });

  it("riders and strangers can't change orders", () => {
    expect(canTransition({ from: "ready", to: "out_for_delivery", orderType: "delivery", role: "rider" }).ok).toBe(false);
    expect(canTransition({ from: "accepted", to: "preparing", orderType: "pickup", role: null }).ok).toBe(false);
  });

  it("held orders can't move forward, but can be cancelled", () => {
    expect(canTransition({ from: "accepted", to: "preparing", orderType: "pickup", role: "staff", isOnHold: true })).toMatchObject({
      ok: false,
      code: "ON_HOLD",
    });
    expect(canTransition({ from: "accepted", to: "cancelled", orderType: "pickup", role: "staff", isOnHold: true }).ok).toBe(true);
  });
});

describe("cancel rules", () => {
  it("staff can reject new orders and cancel accepted ones", () => {
    expect(canTransition({ from: "awaiting_acceptance", to: "cancelled", orderType: "delivery", role: "staff" }).ok).toBe(true);
    expect(canTransition({ from: "accepted", to: "cancelled", orderType: "delivery", role: "staff" }).ok).toBe(true);
  });

  it("only managers can cancel orders being prepared or ready", () => {
    for (const from of ["preparing", "ready"] as const) {
      expect(canTransition({ from, to: "cancelled", orderType: "delivery", role: "staff" }).ok).toBe(false);
      expect(canTransition({ from, to: "cancelled", orderType: "delivery", role: "manager" }).ok).toBe(true);
      expect(canTransition({ from, to: "cancelled", orderType: "delivery", role: "owner" }).ok).toBe(true);
    }
  });

  it("out-for-delivery orders fail instead of being cancelled", () => {
    expect(canTransition({ from: "out_for_delivery", to: "cancelled", orderType: "delivery", role: "owner" }).ok).toBe(false);
    expect(canTransition({ from: "out_for_delivery", to: "failed", orderType: "delivery", role: "staff" }).ok).toBe(true);
  });
});

describe("edit rules by role", () => {
  it("front of house can edit new and accepted orders", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      expect(canEdit("awaiting_acceptance", role)).toEqual({ ok: true, kitchenAlert: false });
      expect(canEdit("accepted", role)).toEqual({ ok: true, kitchenAlert: false });
    }
  });

  it("preparing orders: manager+ only, and the kitchen is alerted", () => {
    expect(canEdit("preparing", "staff").ok).toBe(false);
    expect(canEdit("preparing", "manager")).toEqual({ ok: true, kitchenAlert: true });
    expect(canEdit("preparing", "owner")).toEqual({ ok: true, kitchenAlert: true });
  });

  it("nobody edits ready or finished orders; kitchen never edits", () => {
    for (const status of ["ready", "out_for_delivery", "delivered", "completed", "cancelled"] as const) {
      expect(canEdit(status, "owner").ok).toBe(false);
    }
    expect(canEdit("accepted", "kitchen").ok).toBe(false);
  });
});

describe("nextActions", () => {
  it("offers Accept and Accept & start for new orders", () => {
    expect(nextActions({ status: "awaiting_acceptance", orderType: "delivery", isOnHold: false }, "staff").map((a) => a.key)).toEqual([
      "accept",
      "accept_start",
    ]);
  });

  it("offers the right finish for each order type", () => {
    expect(nextActions({ status: "ready", orderType: "delivery", isOnHold: false }, "staff").map((a) => a.key)).toEqual(["dispatch"]);
    expect(nextActions({ status: "ready", orderType: "pickup", isOnHold: false }, "staff").map((a) => a.key)).toEqual(["complete"]);
  });

  it("offers nothing on hold", () => {
    expect(nextActions({ status: "accepted", orderType: "pickup", isOnHold: true }, "staff")).toEqual([]);
  });
});
