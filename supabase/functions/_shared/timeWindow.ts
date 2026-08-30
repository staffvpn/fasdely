export interface DaySchedule {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
  closed?: boolean;
}

export type WeeklySchedule = Partial<
  Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", DaySchedule>
>;

const WEEKDAY_MAP: Record<string, keyof WeeklySchedule> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

function localParts(at: Date, timezone: string): { weekday: keyof WeeklySchedule; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const weekdayShort = parts.find((p) => p.type === "weekday")!.value;
  let hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  if (hour === 24) hour = 0;
  return { weekday: WEEKDAY_MAP[weekdayShort], minutes: hour * 60 + minute };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinSchedule(at: Date, schedule: WeeklySchedule, timezone: string): boolean {
  const { weekday, minutes } = localParts(at, timezone);
  const day = schedule[weekday];
  if (!day || day.closed) return false;
  return minutes >= toMinutes(day.open) && minutes <= toMinutes(day.close);
}

export interface RequestedTimeCheck {
  ok: boolean;
  reason?: "location_closed" | "too_soon" | "outside_hours";
}

export function validateRequestedTime(
  mode: "asap" | "scheduled",
  requestedAt: Date | null,
  now: Date,
  schedule: WeeklySchedule,
  timezone: string,
  prepTimeMinutes: number
): RequestedTimeCheck {
  if (!isWithinSchedule(now, schedule, timezone)) {
    return { ok: false, reason: "location_closed" };
  }
  if (mode === "asap") return { ok: true };

  if (!requestedAt || !isWithinSchedule(requestedAt, schedule, timezone)) {
    return { ok: false, reason: "outside_hours" };
  }
  const minAllowed = new Date(now.getTime() + prepTimeMinutes * 60000);
  if (requestedAt < minAllowed) {
    return { ok: false, reason: "too_soon" };
  }
  return { ok: true };
}
