import { describe, it, expect } from "vitest";
import { h, formatPrice } from "./dom.ts";

describe("h", () => {
  it("creates an element with attributes and text children", () => {
    const el = h("div", { class: "p-card" }, ["hello"]);
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("p-card");
    expect(el.textContent).toBe("hello");
  });

  it("nests element children", () => {
    const inner = h("span", {}, ["inner"]);
    const outer = h("div", {}, [inner]);
    expect(outer.children).toHaveLength(1);
    expect(outer.firstElementChild).toBe(inner);
  });

  it("never interprets text as markup (XSS safety)", () => {
    const el = h("div", {}, ['<img src=x onerror="alert(1)">']);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror="alert(1)">');
  });
});

describe("formatPrice", () => {
  it("formats a whole ruble amount with the currency sign", () => {
    expect(formatPrice(280)).toBe("280 ₽");
  });
  it("groups thousands with a space", () => {
    expect(formatPrice(1842)).toBe("1 842 ₽");
  });
});
