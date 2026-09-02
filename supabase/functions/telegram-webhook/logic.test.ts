import { describe, it, expect } from "vitest";
import { parseStartCommand, buildMiniAppDeepLink } from "./logic.ts";
import { parseMenuCommand, parseCallbackData, buildProductListKeyboard, parsePriceReplyContext } from "./logic.ts";
import { isSelfServeRole, isGenuineBotPromptReply } from "./logic.ts";
import { staffErrorMessage } from "./logic.ts";

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

describe("parseMenuCommand", () => {
  it("recognizes /меню", () => {
    expect(parseMenuCommand("/меню")).toBe(true);
  });
  it("recognizes /меню@BotUsername", () => {
    expect(parseMenuCommand("/меню@FasdelyBot")).toBe(true);
  });
  it("rejects unrelated text", () => {
    expect(parseMenuCommand("привет")).toBe(false);
  });
  it("rejects undefined", () => {
    expect(parseMenuCommand(undefined)).toBe(false);
  });
});

describe("parseCallbackData", () => {
  it("parses a stop action", () => {
    expect(parseCallbackData("stop:abc-123")).toEqual({ action: "stop", productId: "abc-123" });
  });
  it("parses an unstop action", () => {
    expect(parseCallbackData("unstop:abc-123")).toEqual({ action: "unstop", productId: "abc-123" });
  });
  it("parses a price action", () => {
    expect(parseCallbackData("price:abc-123")).toEqual({ action: "price", productId: "abc-123" });
  });
  it("returns null for malformed data", () => {
    expect(parseCallbackData("nonsense")).toBeNull();
  });
});

describe("buildProductListKeyboard", () => {
  it("builds one row per product with stop/price buttons", () => {
    const kb = buildProductListKeyboard([
      { id: "p1", name: "Капучино", priceLabel: "280 ₽", isStopped: false },
      { id: "p2", name: "Чизкейк", priceLabel: "320 ₽", isStopped: true },
    ]);
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[0][0].text).toContain("Капучино");
    expect(kb.inline_keyboard[0][0].callback_data).toBe("price:p1");
    expect(kb.inline_keyboard[0][1].callback_data).toBe("stop:p1");
    expect(kb.inline_keyboard[1][1].callback_data).toBe("unstop:p2");
  });
});

describe("parsePriceReplyContext", () => {
  it("extracts the embedded product id", () => {
    expect(parsePriceReplyContext("Введите новую цену для Капучино\n\n#pid:abc-123")).toBe("abc-123");
  });
  it("returns null when there is no embedded id", () => {
    expect(parsePriceReplyContext("просто сообщение")).toBeNull();
  });
  it("returns null for undefined", () => {
    expect(parsePriceReplyContext(undefined)).toBeNull();
  });
});

describe("isSelfServeRole", () => {
  it("allows staff", () => {
    expect(isSelfServeRole("staff")).toBe(true);
  });
  it("allows business_owner", () => {
    expect(isSelfServeRole("business_owner")).toBe(true);
  });
  it("rejects fasdely_operator", () => {
    expect(isSelfServeRole("fasdely_operator")).toBe(false);
  });
  it("rejects fasdely_admin", () => {
    expect(isSelfServeRole("fasdely_admin")).toBe(false);
  });
  it("rejects undefined", () => {
    expect(isSelfServeRole(undefined)).toBe(false);
  });
});

describe("isGenuineBotPromptReply", () => {
  it("returns true when the replied-to message is from the bot", () => {
    expect(isGenuineBotPromptReply({ from: { is_bot: true } })).toBe(true);
  });
  it("returns false when the replied-to message is from a human", () => {
    expect(isGenuineBotPromptReply({ from: { is_bot: false } })).toBe(false);
  });
  it("returns false when the replied-to message has no from field", () => {
    expect(isGenuineBotPromptReply({})).toBe(false);
  });
  it("returns false when the replied-to message is undefined", () => {
    expect(isGenuineBotPromptReply(undefined)).toBe(false);
  });
});

describe("staffErrorMessage", () => {
  it("maps not_authorized", () => {
    expect(staffErrorMessage("not_authorized")).toBe("У вас нет доступа к этому действию.");
  });
  it("maps location_not_found", () => {
    expect(staffErrorMessage("location_not_found")).toBe("Точка не найдена.");
  });
  it("maps product_not_found", () => {
    expect(staffErrorMessage("product_not_found")).toBe("Этот товар больше не существует.");
  });
  it("maps invalid_price", () => {
    expect(staffErrorMessage("invalid_price")).toBe("Некорректная цена.");
  });
  it("falls back to a generic message for unknown codes", () => {
    expect(staffErrorMessage("some_unexpected_postgres_error")).toBe("Не удалось выполнить действие. Попробуйте ещё раз.");
  });
});
