import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildMenu, type ProductRow, type StopRow } from "./logic.ts";
import { json, corsHeaders } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const locationId = url.searchParams.get("location_id");
  const qrToken = url.searchParams.get("qr_token");
  if (!locationId && !qrToken) return json({ error: "location_id_or_qr_token_required" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const locationQuery = db
    .from("locations")
    .select("id, business_id, name, status, timezone, working_hours, default_prep_time_minutes");
  const { data: location, error: locError } = qrToken
    ? await locationQuery.eq("qr_token", qrToken).maybeSingle()
    : await locationQuery.eq("id", locationId!).maybeSingle();
  if (locError) return json({ error: "db_error" }, 500);
  if (!location || location.status !== "active") return json({ error: "location_not_found" }, 404);

  const [{ data: categories }, { data: products }, { data: stops }] = await Promise.all([
    db.from("categories").select("id, name, icon, sort_order").eq("business_id", location.business_id).eq("status", "active"),
    db
      .from("products")
      .select(
        "id, category_id, name, description, base_price, image_url, calories, protein_g, fat_g, carbs_g, ingredients, allergens, badges, product_location_overrides!left(location_id, price_override, is_available, is_published)"
      )
      .eq("business_id", location.business_id)
      .eq("status", "published"),
    db
      .from("stop_list")
      .select("scope_type, scope_id, stopped_until, stopped_for_today, created_at")
      .eq("business_id", location.business_id)
      .or(`location_id.is.null,location_id.eq.${location.id}`)
      .is("lifted_at", null),
  ]);

  const productRows: ProductRow[] = (products ?? []).map((p: any) => ({
    ...p,
    location_override:
      (p.product_location_overrides ?? []).find((o: any) => o.location_id === location.id) ?? null,
  }));

  const menu = buildMenu(categories ?? [], productRows, (stops ?? []) as StopRow[], new Date());
  return json({
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
      workingHours: location.working_hours,
      defaultPrepTimeMinutes: location.default_prep_time_minutes,
    },
    ...menu,
  });
});
