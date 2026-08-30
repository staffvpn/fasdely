export interface StopTimingFields {
  stopped_until: string | null;
  stopped_for_today: boolean;
  created_at: string;
}

export function isStopActive(stop: StopTimingFields, now: Date): boolean {
  if (stop.stopped_for_today) {
    const created = new Date(stop.created_at);
    return (
      created.getUTCFullYear() === now.getUTCFullYear() &&
      created.getUTCMonth() === now.getUTCMonth() &&
      created.getUTCDate() === now.getUTCDate()
    );
  }
  if (stop.stopped_until) return new Date(stop.stopped_until) > now;
  return true;
}
