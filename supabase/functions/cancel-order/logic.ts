import { canGuestCancel, type OrderStatus } from "../_shared/orderStateMachine.ts";

export interface CancelCheckInput {
  order_status: OrderStatus;
  order_guest_telegram_user_id: number;
  requesting_telegram_user_id: number;
  cancellable_statuses: OrderStatus[];
}

export type CancelCheckResult = { ok: true } | { ok: false; reason: "forbidden" | "not_cancellable" };

export function checkCancelAllowed(input: CancelCheckInput): CancelCheckResult {
  if (input.order_guest_telegram_user_id !== input.requesting_telegram_user_id) {
    return { ok: false, reason: "forbidden" };
  }
  if (!canGuestCancel(input.order_status, input.cancellable_statuses)) {
    return { ok: false, reason: "not_cancellable" };
  }
  return { ok: true };
}
