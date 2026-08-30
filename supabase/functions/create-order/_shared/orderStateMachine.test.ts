import { describe, it, expect } from "vitest";
import { canStaffTransition, canGuestCancel } from "./orderStateMachine.ts";

describe("canStaffTransition", () => {
  it("allows new -> accepted", () => {
    expect(canStaffTransition("new", "accepted")).toBe(true);
  });
  it("rejects new -> preparing (must go through accepted first)", () => {
    expect(canStaffTransition("new", "preparing")).toBe(false);
  });
  it("rejects any transition out of a terminal state", () => {
    expect(canStaffTransition("handed_out", "preparing")).toBe(false);
    expect(canStaffTransition("cancelled_by_guest", "accepted")).toBe(false);
  });
  it("allows recovering a problem order back into the flow", () => {
    expect(canStaffTransition("problem", "accepted")).toBe(true);
  });
});

describe("canGuestCancel", () => {
  it("allows cancellation while new", () => {
    expect(canGuestCancel("new")).toBe(true);
  });
  it("rejects cancellation once preparing", () => {
    expect(canGuestCancel("preparing")).toBe(false);
  });
  it("respects a custom cancellable-status list", () => {
    expect(canGuestCancel("preparing", ["new", "preparing"])).toBe(true);
  });
});
