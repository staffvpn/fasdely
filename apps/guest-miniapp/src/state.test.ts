import { describe, it, expect, beforeEach } from "vitest";
import { CartStore } from "./state.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("CartStore", () => {
  it("adds a line and computes the total", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    expect(cart.getLines()).toHaveLength(1);
    expect(cart.getTotal()).toBe(280);
  });

  it("merges a second add of the same product+modifiers by summing quantity", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 2, modifierIds: [], modifierLabel: "" });
    expect(cart.getLines()).toHaveLength(1);
    expect(cart.getLines()[0].quantity).toBe(3);
  });

  it("treats the same product with different modifiers as separate lines", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 360, quantity: 1, modifierIds: ["m1"], modifierLabel: "Овсяное" });
    expect(cart.getLines()).toHaveLength(2);
  });

  it("setQuantity updates an existing line", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.setQuantity("p1", [], 5);
    expect(cart.getLines()[0].quantity).toBe(5);
  });

  it("setQuantity to 0 removes the line", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.setQuantity("p1", [], 0);
    expect(cart.getLines()).toHaveLength(0);
  });

  it("remove deletes a specific line", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.remove("p1", []);
    expect(cart.getLines()).toHaveLength(0);
  });

  it("clear empties the cart", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.clear();
    expect(cart.getLines()).toHaveLength(0);
  });

  it("save then load round-trips through localStorage", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 2, modifierIds: [], modifierLabel: "" });
    cart.save();
    const reloaded = CartStore.load();
    expect(reloaded.getLines()).toEqual(cart.getLines());
  });
});
