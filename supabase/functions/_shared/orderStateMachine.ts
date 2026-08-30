export type OrderStatus =
  | "new"
  | "waiting_confirmation"
  | "accepted"
  | "preparing"
  | "ready"
  | "handed_out"
  | "cancelled_by_guest"
  | "cancelled_by_establishment"
  | "expired"
  | "problem";

const STAFF_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["accepted", "cancelled_by_establishment", "problem"],
  waiting_confirmation: ["accepted", "cancelled_by_establishment", "problem"],
  accepted: ["preparing", "cancelled_by_establishment", "problem"],
  preparing: ["ready", "problem"],
  ready: ["handed_out", "problem"],
  handed_out: [],
  cancelled_by_guest: [],
  cancelled_by_establishment: [],
  expired: [],
  problem: ["accepted", "preparing", "cancelled_by_establishment"],
};

const DEFAULT_GUEST_CANCELLABLE: OrderStatus[] = ["new", "waiting_confirmation", "accepted"];

export function canStaffTransition(from: OrderStatus, to: OrderStatus): boolean {
  return STAFF_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canGuestCancel(
  status: OrderStatus,
  cancellableStatuses: OrderStatus[] = DEFAULT_GUEST_CANCELLABLE
): boolean {
  return cancellableStatuses.includes(status);
}
