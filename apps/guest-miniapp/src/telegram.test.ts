import { describe, it, expect } from "vitest";
import { parseThemeParams } from "./telegram.ts";

describe("parseThemeParams", () => {
  it("extracts bg and text colors when present", () => {
    expect(parseThemeParams({ bg_color: "#ffffff", text_color: "#111111" })).toEqual({
      bg: "#ffffff",
      text: "#111111",
    });
  });
  it("returns null when theme params are absent", () => {
    expect(parseThemeParams(undefined)).toBeNull();
  });
  it("returns null when required keys are missing", () => {
    expect(parseThemeParams({ bg_color: "#ffffff" })).toBeNull();
  });
});
