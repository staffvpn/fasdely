import { describe, it, expect } from "vitest";
import { parseStartCommand, buildMiniAppDeepLink } from "./logic.ts";

describe("parseStartCommand", () => {
  it("parses /start with a payload", () => {
    expect(parseStartCommand("/start abc123")).toEqual({ command: "start", payload: "abc123" });
  });
  it("parses /start with no payload", () => {
    expect(parseStartCommand("/start")).toEqual({ command: "start", payload: "" });
  });
  it("parses /start@BotUsername with a payload", () => {
    expect(parseStartCommand("/start@FasdelyBot xyz")).toEqual({ command: "start", payload: "xyz" });
  });
  it("returns null for unrelated text", () => {
    expect(parseStartCommand("hello there")).toBeNull();
  });
  it("returns null for undefined text", () => {
    expect(parseStartCommand(undefined)).toBeNull();
  });
});

describe("buildMiniAppDeepLink", () => {
  it("builds a t.me startapp link", () => {
    expect(buildMiniAppDeepLink("FasdelyBot", "abc 123")).toBe("https://t.me/FasdelyBot/app?startapp=abc%20123");
  });
});
