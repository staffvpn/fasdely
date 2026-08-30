import { isStopActive } from "../_shared/stopList.ts";

export interface CategoryRow {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
}

export interface ProductRow {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  base_price: number;
  image_url: string | null;
  calories: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  ingredients: string | null;
  allergens: string[];
  badges: string[];
  location_override: { price_override: number | null; is_available: boolean; is_published: boolean } | null;
}

export interface StopRow {
  scope_type: "product" | "modifier" | "category" | "collection";
  scope_id: string;
  stopped_until: string | null;
  stopped_for_today: boolean;
  created_at: string;
}

export interface MenuProduct {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  calories: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  ingredients: string | null;
  allergens: string[];
  badges: string[];
}

export function buildMenu(
  categories: CategoryRow[],
  products: ProductRow[],
  stops: StopRow[],
  now: Date
): { categories: CategoryRow[]; products: MenuProduct[] } {
  const activeStops = stops.filter((s) => isStopActive(s, now));
  const stoppedProductIds = new Set(activeStops.filter((s) => s.scope_type === "product").map((s) => s.scope_id));
  const stoppedCategoryIds = new Set(activeStops.filter((s) => s.scope_type === "category").map((s) => s.scope_id));

  const products_ = products
    .filter((p) => !stoppedProductIds.has(p.id))
    .filter((p) => !p.category_id || !stoppedCategoryIds.has(p.category_id))
    .filter((p) => p.location_override?.is_available !== false)
    .filter((p) => p.location_override?.is_published !== false)
    .map<MenuProduct>((p) => ({
      id: p.id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      price: p.location_override?.price_override ?? p.base_price,
      image_url: p.image_url,
      calories: p.calories,
      protein_g: p.protein_g,
      fat_g: p.fat_g,
      carbs_g: p.carbs_g,
      ingredients: p.ingredients,
      allergens: p.allergens,
      badges: p.badges,
    }));

  return {
    categories: [...categories].sort((a, b) => a.sort_order - b.sort_order),
    products: products_,
  };
}
