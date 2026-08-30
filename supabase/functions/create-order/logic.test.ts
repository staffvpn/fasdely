import { describe, it, expect } from "vitest";
import {
  validateAndPriceOrder,
  type CartItemInput,
  type ProductCatalogEntry,
  type ModifierCatalogEntry,
  type StopEntry,
} from "./logic.ts";

const NOW = new Date("2026-08-31T10:00:00Z");

function products(...entries: Partial<ProductCatalogEntry>[]): Map<string, ProductCatalogEntry> {
  const map = new Map<string, ProductCatalogEntry>();
  for (const e of entries) {
    const full: ProductCatalogEntry = {
      id: "prod-1",
      name: "Cappuccino",
      base_price: 280,
      status: "published",
      location_override: null,
      ...e,
    };
    map.set(full.id, full);
  }
  return map;
}

function pmg(entries: Record<string, string[]>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [productId, groupIds] of Object.entries(entries)) {
    map.set(productId, new Set(groupIds));
  }
  return map;
}

describe("validateAndPriceOrder", () => {
  it("rejects an empty cart", () => {
    const result = validateAndPriceOrder([], products(), new Map(), pmg({}), [], NOW);
    expect(result).toEqual({ ok: false, reason: "empty_cart" });
  });

  it("rejects an unknown product", () => {
    const items: CartItemInput[] = [{ product_id: "missing", quantity: 1, modifier_ids: [] }];
    const result = validateAndPriceOrder(items, products(), new Map(), pmg({}), [], NOW);
    expect(result).toEqual({ ok: false, reason: "product_not_found", product_id: "missing" });
  });

  it("rejects a draft (unpublished) product", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: [] }];
    const result = validateAndPriceOrder(items, products({ status: "draft" }), new Map(), pmg({}), [], NOW);
    expect(result).toEqual({ ok: false, reason: "product_not_found", product_id: "prod-1" });
  });

  it("rejects a product unavailable at this location", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: [] }];
    const p = products({ location_override: { price_override: null, is_available: false, is_published: true } });
    const result = validateAndPriceOrder(items, p, new Map(), pmg({}), [], NOW);
    expect(result).toEqual({ ok: false, reason: "product_unavailable", product_id: "prod-1" });
  });

  it("rejects a product with an active stop", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: [] }];
    const stops: StopEntry[] = [
      { scope_type: "product", scope_id: "prod-1", stopped_until: null, stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = validateAndPriceOrder(items, products({}), new Map(), pmg({}), stops, NOW);
    expect(result).toEqual({ ok: false, reason: "product_unavailable", product_id: "prod-1" });
  });

  it("rejects a stopped modifier", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: ["mod-1"] }];
    const modifiers = new Map<string, ModifierCatalogEntry>([
      ["mod-1", { id: "mod-1", group_id: "g1", name: "Oat milk", price_delta: 80 }],
    ]);
    const stops: StopEntry[] = [
      { scope_type: "modifier", scope_id: "mod-1", stopped_until: null, stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = validateAndPriceOrder(items, products({}), modifiers, pmg({ "prod-1": ["g1"] }), stops, NOW);
    expect(result).toEqual({ ok: false, reason: "product_unavailable", product_id: "prod-1" });
  });

  it("rejects a non-positive or non-integer quantity", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 0, modifier_ids: [] }];
    const result = validateAndPriceOrder(items, products(), new Map(), pmg({}), [], NOW);
    expect(result).toEqual({ ok: false, reason: "invalid_quantity", product_id: "prod-1" });
  });

  it("prices a cart with a location override and a modifier, across quantity", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 2, modifier_ids: ["mod-1"] }];
    const p = products({ location_override: { price_override: 250, is_available: true, is_published: true } });
    const modifiers = new Map<string, ModifierCatalogEntry>([
      ["mod-1", { id: "mod-1", group_id: "g1", name: "Oat milk", price_delta: 80 }],
    ]);
    const result = validateAndPriceOrder(items, p, modifiers, pmg({ "prod-1": ["g1"] }), [], NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // (250 override + 80 modifier) * 2 = 660
      expect(result.items[0].unit_price_snapshot).toBe(330);
      expect(result.items[0].line_total).toBe(660);
      expect(result.subtotal).toBe(660);
      expect(result.total).toBe(660);
    }
  });

  it("rejects a cart item referencing an unknown modifier id instead of silently zeroing its price", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: ["mod-missing"] }];
    // modifiers map is empty (e.g. the modifier id doesn't exist, or belongs to
    // a different business and was filtered out by the caller's tenant scoping)
    const result = validateAndPriceOrder(items, products({}), new Map(), pmg({ "prod-1": ["g1"] }), [], NOW);
    expect(result).toEqual({ ok: false, reason: "modifier_not_found", product_id: "prod-1" });
  });

  it("rejects a cart item referencing a modifier that exists but isn't attached to this product", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: ["mod-1"] }];
    const modifiers = new Map<string, ModifierCatalogEntry>([
      ["mod-1", { id: "mod-1", group_id: "g-other", name: "Oat milk", price_delta: 80 }],
    ]);
    // prod-1 only has group "g1" attached via product_modifier_groups, not "g-other"
    const result = validateAndPriceOrder(items, products({}), modifiers, pmg({ "prod-1": ["g1"] }), [], NOW);
    expect(result).toEqual({ ok: false, reason: "modifier_not_found", product_id: "prod-1" });
  });
});
