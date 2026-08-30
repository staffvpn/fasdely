import { describe, it, expect } from "vitest";
import { buildMenu, type CategoryRow, type ProductRow, type StopRow } from "./logic.ts";

const NOW = new Date("2026-08-31T10:00:00Z");

const CATEGORIES: CategoryRow[] = [
  { id: "cat-2", name: "Bakery", icon: null, sort_order: 2 },
  { id: "cat-1", name: "Coffee", icon: null, sort_order: 1 },
];

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "prod-1",
    category_id: "cat-1",
    name: "Cappuccino",
    description: "Classic",
    base_price: 280,
    image_url: null,
    calories: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
    ingredients: null,
    allergens: [],
    badges: [],
    location_override: null,
    ...overrides,
  };
}

describe("buildMenu", () => {
  it("sorts categories by sort_order", () => {
    const result = buildMenu(CATEGORIES, [], [], NOW);
    expect(result.categories.map((c) => c.id)).toEqual(["cat-1", "cat-2"]);
  });

  it("excludes a product with an active product-level stop", () => {
    const stops: StopRow[] = [
      { scope_type: "product", scope_id: "prod-1", stopped_until: null, stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = buildMenu(CATEGORIES, [product()], stops, NOW);
    expect(result.products).toHaveLength(0);
  });

  it("excludes a product whose category is stopped", () => {
    const stops: StopRow[] = [
      { scope_type: "category", scope_id: "cat-1", stopped_until: null, stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = buildMenu(CATEGORIES, [product()], stops, NOW);
    expect(result.products).toHaveLength(0);
  });

  it("includes a product whose stop has already expired (stopped_until in the past)", () => {
    const stops: StopRow[] = [
      { scope_type: "product", scope_id: "prod-1", stopped_until: "2026-08-30T00:00:00Z", stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = buildMenu(CATEGORIES, [product()], stops, NOW);
    expect(result.products).toHaveLength(1);
  });

  it("stopped_for_today only applies on the day it was created", () => {
    const stops: StopRow[] = [
      { scope_type: "product", scope_id: "prod-1", stopped_until: null, stopped_for_today: true, created_at: "2026-08-30T09:00:00Z" },
    ];
    const result = buildMenu(CATEGORIES, [product()], stops, NOW); // NOW is the next day
    expect(result.products).toHaveLength(1);
  });

  it("applies a location price override", () => {
    const p = product({ location_override: { price_override: 250, is_available: true, is_published: true } });
    const result = buildMenu(CATEGORIES, [p], [], NOW);
    expect(result.products[0].price).toBe(250);
  });

  it("excludes a product marked unavailable at this location", () => {
    const p = product({ location_override: { price_override: null, is_available: false, is_published: true } });
    const result = buildMenu(CATEGORIES, [p], [], NOW);
    expect(result.products).toHaveLength(0);
  });

  it("excludes a product marked unpublished at this location", () => {
    const p = product({ location_override: { price_override: null, is_available: true, is_published: false } });
    const result = buildMenu(CATEGORIES, [p], [], NOW);
    expect(result.products).toHaveLength(0);
  });
});
