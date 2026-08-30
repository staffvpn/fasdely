import { describe, it, expect } from "vitest";
import { isWithinSchedule, validateRequestedTime, type WeeklySchedule } from "./timeWindow.ts";

// 2026-08-31T10:00:00Z is a Monday in UTC.
const MONDAY_10AM = new Date("2026-08-31T10:00:00Z");
const SCHEDULE: WeeklySchedule = {
  mon: { open: "08:00", close: "20:00" },
};

describe("isWithinSchedule", () => {
  it("is true during open hours", () => {
    expect(isWithinSchedule(MONDAY_10AM, SCHEDULE, "UTC")).toBe(true);
  });
  it("is false before opening", () => {
    expect(isWithinSchedule(new Date("2026-08-31T05:00:00Z"), SCHEDULE, "UTC")).toBe(false);
  });
  it("is false after closing", () => {
    expect(isWithinSchedule(new Date("2026-08-31T21:00:00Z"), SCHEDULE, "UTC")).toBe(false);
  });
  it("is false on a day with no schedule entry", () => {
    expect(isWithinSchedule(new Date("2026-09-01T10:00:00Z"), SCHEDULE, "UTC")).toBe(false); // Tuesday
  });
});

describe("validateRequestedTime", () => {
  it("accepts ASAP during open hours", () => {
    const result = validateRequestedTime("asap", null, MONDAY_10AM, SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(true);
  });
  it("rejects ASAP outside open hours", () => {
    const result = validateRequestedTime("asap", null, new Date("2026-08-31T21:00:00Z"), SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("location_closed");
  });
  it("rejects a scheduled time sooner than the prep time", () => {
    const requested = new Date(MONDAY_10AM.getTime() + 5 * 60000); // only 5 min ahead
    const result = validateRequestedTime("scheduled", requested, MONDAY_10AM, SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too_soon");
  });
  it("rejects a scheduled time outside working hours", () => {
    const requested = new Date("2026-08-31T21:00:00Z");
    const result = validateRequestedTime("scheduled", requested, MONDAY_10AM, SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("outside_hours");
  });
  it("accepts a valid scheduled time", () => {
    const requested = new Date(MONDAY_10AM.getTime() + 30 * 60000);
    const result = validateRequestedTime("scheduled", requested, MONDAY_10AM, SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(true);
  });
});
