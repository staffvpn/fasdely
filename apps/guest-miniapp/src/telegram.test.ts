import { describe, it, expect, vi, afterEach } from "vitest";
import { parseThemeParams, onBackButtonClick } from "./telegram.ts";

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

describe("onBackButtonClick", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces the previously registered handler instead of accumulating", () => {
    const onClick = vi.fn();
    const offClick = vi.fn();
    vi.stubGlobal("Telegram", {
      WebApp: { BackButton: { onClick, offClick, show: vi.fn(), hide: vi.fn() } },
    });

    const handlerA = () => {};
    const handlerB = () => {};

    onBackButtonClick(handlerA);
    expect(onClick).toHaveBeenCalledWith(handlerA);
    expect(offClick).not.toHaveBeenCalled();

    onBackButtonClick(handlerB);
    expect(offClick).toHaveBeenCalledWith(handlerA);
    expect(onClick).toHaveBeenCalledWith(handlerB);
    expect(offClick).toHaveBeenCalledTimes(1);
  });
});
