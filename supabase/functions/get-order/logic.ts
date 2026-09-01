export function checkOrderOwnership(orderGuestTelegramUserId: number, requestingTelegramUserId: number): boolean {
  return orderGuestTelegramUserId === requestingTelegramUserId;
}
