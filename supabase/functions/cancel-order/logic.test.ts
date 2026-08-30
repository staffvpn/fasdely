import { describe, it, expect } from "vitest";
import { checkCancelAllowed } from "./logic.ts";

describe("checkCancelAllowed", () => {
  const base = {
    order_status: "new" as const,
    order_guest_telegram_user_id: 111,
    requesting_telegram_user_id: 111,
    cancellable_statuses: ["new", "waiting_confirmation", "accepted"] as const,
  };

  it("allows the owning guest to cancel a cancellable order", () => {
    expect(checkCancelAllowed({ ...base })).toEqual({ ok: true });
  });

  it("forbids a guest cancelling someone else's order", () => {
    const result = checkCancelAllowed({ ...base, requesting_telegram_user_id: 222 });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("checks ownership before checking cancellability", () => {
    // wrong guest AND a non-cancellable status: must still report "forbidden"
    const result = checkCancelAllowed({ ...base, requesting_telegram_user_id: 222, order_status: "preparing" as any });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("rejects cancelling an order that is already preparing", () => {
    const result = checkCancelAllowed({ ...base, order_status: "preparing" as any });
    expect(result).toEqual({ ok: false, reason: "not_cancellable" });
  });
});
