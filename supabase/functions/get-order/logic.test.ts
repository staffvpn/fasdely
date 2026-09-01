import { describe, it, expect } from "vitest";
import { checkOrderOwnership } from "./logic.ts";

describe("checkOrderOwnership", () => {
  it("allows the owning guest", () => {
    expect(checkOrderOwnership(111, 111)).toBe(true);
  });
  it("denies a different guest", () => {
    expect(checkOrderOwnership(111, 222)).toBe(false);
  });
});
