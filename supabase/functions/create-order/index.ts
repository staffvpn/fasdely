import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyTelegramInitData } from "../_shared/telegramAuth.ts";
import { validateRequestedTime, type WeeklySchedule } from "../_shared/timeWindow.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import {
  validateAndPriceOrder,
  type CartItemInput,
  type ProductCatalogEntry,
  type ModifierCatalogEntry,
  type StopEntry,
} from "./logic.ts";

interface CreateOrderBody {
  init_data: string;
  location_id: string;
  table_id?: string | null;
  order_type: "dine_in" | "takeaway";
  requested_time_mode: "asap" | "scheduled";
  requested_time?: string | null;
  comment?: string | null;
  idempotency_key: string;
  items: CartItemInput[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const auth = await verifyTelegramInitData(body.init_data, Deno.env.get("TELEGRAM_BOT_TOKEN")!);
  if (!auth.valid || !auth.user) return json({ error: "unauthorized", reason: auth.reason }, 401);

  if (!body.location_id || !body.order_type || !body.idempotency_key || !Array.isArray(body.items)) {
    return json({ error: "invalid_request" }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: existing } = await db
    .from("orders")
    .select("id, order_number, status, total")
    .eq("location_id", body.location_id)
    .eq("guest_telegram_user_id", auth.user.id)
    .eq("idempotency_key", body.idempotency_key)
    .maybeSingle();
  if (existing) return json({ order: existing }, 200);

  const { data: location } = await db
    .from("locations")
    .select("id, business_id, status, timezone, working_hours, default_prep_time_minutes")
    .eq("id", body.location_id)
    .maybeSingle();
  if (!location || location.status !== "active") return json({ error: "location_not_found" }, 404);

  const now = new Date();
  const timeCheck = validateRequestedTime(
    body.requested_time_mode,
    body.requested_time ? new Date(body.requested_time) : null,
    now,
    (location.working_hours ?? {}) as WeeklySchedule,
    location.timezone,
    location.default_prep_time_minutes
  );
  if (!timeCheck.ok) return json({ error: "invalid_time", reason: timeCheck.reason }, 422);

  const productIds = [...new Set(body.items.map((i) => i.product_id))];
  const { data: productRows } = await db
    .from("products")
    .select(
      "id, name, base_price, status, business_id, category_id, product_location_overrides!left(location_id, price_override, is_available, is_published)"
    )
    .in("id", productIds);

  const productMap = new Map<string, ProductCatalogEntry>();
  for (const p of productRows ?? []) {
    if (p.business_id !== location.business_id) continue;
    const override = (p.product_location_overrides ?? []).find((o: any) => o.location_id === body.location_id) ?? null;
    productMap.set(p.id, {
      id: p.id,
      name: p.name,
      base_price: p.base_price,
      status: p.status,
      category_id: p.category_id,
      location_override: override,
    });
  }

  const modifierIds = [...new Set(body.items.flatMap((i) => i.modifier_ids ?? []))];
  const { data: modifierRows } = modifierIds.length
    ? await db
        .from("modifiers")
        .select("id, modifier_group_id, name, price_delta, modifier_groups(business_id)")
        .in("id", modifierIds)
    : { data: [] as any[] };

  const modifierMap = new Map<string, ModifierCatalogEntry>();
  for (const m of modifierRows ?? []) {
    if ((m as any).modifier_groups?.business_id !== location.business_id) continue;
    modifierMap.set(m.id, { id: m.id, group_id: m.modifier_group_id, name: m.name, price_delta: m.price_delta });
  }

  // Which modifier_groups are actually attached to which cart products, so a
  // modifier that exists (and is in the right business) but was never linked
  // to this specific product via product_modifier_groups is still rejected.
  const { data: pmgRows } = await db
    .from("product_modifier_groups")
    .select("product_id, modifier_group_id")
    .in("product_id", productIds);
  const productModifierGroups = new Map<string, Set<string>>();
  for (const row of pmgRows ?? []) {
    const set = productModifierGroups.get(row.product_id) ?? new Set<string>();
    set.add(row.modifier_group_id);
    productModifierGroups.set(row.product_id, set);
  }

  const { data: stopRows } = await db
    .from("stop_list")
    .select("scope_type, scope_id, stopped_until, stopped_for_today, created_at")
    .eq("business_id", location.business_id)
    .or(`location_id.is.null,location_id.eq.${body.location_id}`)
    .is("lifted_at", null);

  const result = validateAndPriceOrder(
    body.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, modifier_ids: i.modifier_ids ?? [] })),
    productMap,
    modifierMap,
    productModifierGroups,
    (stopRows ?? []) as StopEntry[],
    now
  );
  if (!result.ok) return json({ error: result.reason, product_id: (result as any).product_id }, 422);

  await db.from("guests").upsert({
    telegram_user_id: auth.user.id,
    first_name: auth.user.first_name,
    username: auth.user.username,
    last_seen_at: now.toISOString(),
  });

  const { data: orderNumber } = await db.rpc("next_order_number", { p_location_id: body.location_id });

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      location_id: body.location_id,
      table_id: body.table_id ?? null,
      guest_telegram_user_id: auth.user.id,
      order_type: body.order_type,
      requested_time_mode: body.requested_time_mode,
      requested_time: body.requested_time ?? null,
      status: "new",
      comment: body.comment ?? null,
      subtotal: result.subtotal,
      total: result.total,
      order_number: orderNumber,
      idempotency_key: body.idempotency_key,
    })
    .select()
    .single();

  if (orderError || !order) {
    if ((orderError as any)?.code === "23505") {
      const { data: raceExisting } = await db
        .from("orders")
        .select("id, order_number, status, total")
        .eq("location_id", body.location_id)
        .eq("guest_telegram_user_id", auth.user.id)
        .eq("idempotency_key", body.idempotency_key)
        .maybeSingle();
      if (raceExisting) return json({ order: raceExisting }, 200);
    }
    return json({ error: "order_create_failed" }, 500);
  }

  const { error: itemsError } = await db.from("order_items").insert(
    result.items.map((i) => ({
      order_id: order.id,
      product_id: i.product_id,
      product_name_snapshot: i.product_name_snapshot,
      unit_price_snapshot: i.unit_price_snapshot,
      quantity: i.quantity,
      modifiers_snapshot: i.modifiers_snapshot,
      line_total: i.line_total,
    }))
  );

  if (itemsError) {
    // Compensating action: an order with no line items must never reach the
    // guest as a 201. This is an interim fix, not full atomicity — a future
    // improvement would wrap all 3 inserts in a single `security definer` SQL
    // function so the whole thing commits or rolls back as one transaction.
    await db.from("orders").delete().eq("id", order.id);
    return json({ error: "order_create_failed" }, 500);
  }

  const { error: eventError } = await db.from("order_events").insert({
    order_id: order.id,
    event_type: "status_change",
    from_status: null,
    to_status: "new",
    actor_type: "guest",
    actor_id: String(auth.user.id),
  });
  if (eventError) {
    // The order and its items are valid at this point; a missing initial
    // lifecycle event is a lesser problem than missing items, so log and
    // still return 201 rather than rolling back a otherwise-good order.
    console.error("create-order: failed to insert initial order_event", eventError);
  }

  return json({ order }, 201);
});
