import { describe, it, expect } from "vitest";
import { isStopActive } from "./stopList.ts";

const NOW = new Date("2026-08-31T10:00:00Z");

describe("isStopActive", () => {
  it("is active with no stopped_until and no stopped_for_today (manual/indefinite stop)", () => {
    expect(isStopActive({ stopped_until: null, stopped_for_today: false, created_at: NOW.toISOString() }, NOW)).toBe(true);
  });

  it("is active while stopped_until is in the future", () => {
    expect(isStopActive({ stopped_until: "2026-08-31T12:00:00Z", stopped_for_today: false, created_at: NOW.toISOString() }, NOW)).toBe(true);
  });

  it("is inactive once stopped_until is in the past", () => {
    expect(isStopActive({ stopped_until: "2026-08-30T00:00:00Z", stopped_for_today: false, created_at: NOW.toISOString() }, NOW)).toBe(false);
  });

  it("stopped_for_today is active on the day it was created", () => {
    expect(isStopActive({ stopped_until: null, stopped_for_today: true, created_at: "2026-08-31T09:00:00Z" }, NOW)).toBe(true);
  });

  it("stopped_for_today is inactive on a later day", () => {
    expect(isStopActive({ stopped_until: null, stopped_for_today: true, created_at: "2026-08-30T09:00:00Z" }, NOW)).toBe(false);
  });
});
