import { describe, it, expect } from "vitest";
import { getErrorMessage } from "./errors.ts";

describe("getErrorMessage", () => {
  it("maps location_not_found", () => {
    expect(getErrorMessage("location_not_found")).toContain("не принимаем заказы");
  });
  it("maps product_unavailable", () => {
    expect(getErrorMessage("product_unavailable")).toContain("закончился");
  });
  it("maps unauthorized to the initData-refresh message", () => {
    expect(getErrorMessage("unauthorized")).toContain("Откройте меню заново");
  });
  it("maps invalid_time with a reason-specific detail", () => {
    expect(getErrorMessage("invalid_time", "too_soon")).toContain("время");
  });
  it("falls back to a generic message for unknown errors", () => {
    expect(getErrorMessage("something_never_seen_before")).toBe("Что-то пошло не так. Попробуйте ещё раз.");
  });
});
