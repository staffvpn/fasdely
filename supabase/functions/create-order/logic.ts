import { isStopActive } from "../_shared/stopList.ts";

export interface CartItemInput {
  product_id: string;
  quantity: number;
  modifier_ids: string[];
}

export interface ProductCatalogEntry {
  id: string;
  name: string;
  base_price: number;
  status: "draft" | "published" | "archived";
  category_id: string | null;
  location_override: { price_override: number | null; is_available: boolean; is_published: boolean } | null;
}

export interface ModifierCatalogEntry {
  id: string;
  group_id: string;
  name: string;
  price_delta: number;
}

export interface StopEntry {
  scope_type: "product" | "modifier" | "category" | "collection";
  scope_id: string;
  stopped_until: string | null;
  stopped_for_today: boolean;
  created_at: string;
}

export interface PricedItem {
  product_id: string;
  product_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  modifiers_snapshot: { id: string; name: string; price_delta: number }[];
  line_total: number;
}

export type OrderValidationResult =
  | { ok: true; items: PricedItem[]; subtotal: number; total: number }
  | {
      ok: false;
      reason: "empty_cart" | "product_unavailable" | "product_not_found" | "invalid_quantity" | "modifier_not_found";
      product_id?: string;
    };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function validateAndPriceOrder(
  items: CartItemInput[],
  products: Map<string, ProductCatalogEntry>,
  modifiers: Map<string, ModifierCatalogEntry>,
  productModifierGroups: Map<string, Set<string>>,
  stops: StopEntry[],
  now: Date
): OrderValidationResult {
  if (items.length === 0) return { ok: false, reason: "empty_cart" };

  const activeStops = stops.filter((s) => isStopActive(s, now));
  const stoppedProductIds = new Set(activeStops.filter((s) => s.scope_type === "product").map((s) => s.scope_id));
  const stoppedModifierIds = new Set(activeStops.filter((s) => s.scope_type === "modifier").map((s) => s.scope_id));
  const stoppedCategoryIds = new Set(activeStops.filter((s) => s.scope_type === "category").map((s) => s.scope_id));

  const priced: PricedItem[] = [];

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, reason: "invalid_quantity", product_id: item.product_id };
    }

    const product = products.get(item.product_id);
    if (!product || product.status !== "published") {
      return { ok: false, reason: "product_not_found", product_id: item.product_id };
    }

    const override = product.location_override;
    const available = override ? override.is_available && override.is_published : true;
    if (
      !available ||
      stoppedProductIds.has(product.id) ||
      (product.category_id && stoppedCategoryIds.has(product.category_id))
    ) {
      return { ok: false, reason: "product_unavailable", product_id: item.product_id };
    }
    if (item.modifier_ids.some((id) => stoppedModifierIds.has(id))) {
      return { ok: false, reason: "product_unavailable", product_id: item.product_id };
    }

    const allowedGroups = productModifierGroups.get(product.id) ?? new Set<string>();
    const selectedModifiers: { id: string; name: string; price_delta: number }[] = [];
    for (const id of item.modifier_ids) {
      const m = modifiers.get(id);
      // Reject outright rather than silently defaulting to a zero price delta:
      // an unrecognized id (never scoped to this business) or a modifier not
      // actually attached to this product via product_modifier_groups must
      // not be allowed to price in at all.
      if (!m || !allowedGroups.has(m.group_id)) {
        return { ok: false, reason: "modifier_not_found", product_id: item.product_id };
      }
      selectedModifiers.push({ id: m.id, name: m.name, price_delta: m.price_delta });
    }

    const basePrice = override?.price_override ?? product.base_price;
    const modifiersTotal = selectedModifiers.reduce((sum, m) => sum + m.price_delta, 0);
    const unitPrice = round2(basePrice + modifiersTotal);
    const lineTotal = round2(unitPrice * item.quantity);

    priced.push({
      product_id: product.id,
      product_name_snapshot: product.name,
      unit_price_snapshot: unitPrice,
      quantity: item.quantity,
      modifiers_snapshot: selectedModifiers,
      line_total: lineTotal,
    });
  }

  const subtotal = round2(priced.reduce((sum, i) => sum + i.line_total, 0));
  return { ok: true, items: priced, subtotal, total: subtotal };
}
