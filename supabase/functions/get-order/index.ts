import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyTelegramInitData } from "../_shared/telegramAuth.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { checkOrderOwnership } from "./logic.ts";

interface GetOrderBody {
  init_data: string;
  order_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: GetOrderBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const auth = await verifyTelegramInitData(body.init_data, Deno.env.get("TELEGRAM_BOT_TOKEN")!);
  if (!auth.valid || !auth.user) return json({ error: "unauthorized", reason: auth.reason }, 401);
  if (!body.order_id) return json({ error: "invalid_request" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: order } = await db
    .from("orders")
    .select("id, order_number, status, order_type, requested_time_mode, requested_time, comment, subtotal, total, currency, created_at, guest_telegram_user_id")
    .eq("id", body.order_id)
    .maybeSingle();
  if (!order) return json({ error: "order_not_found" }, 404);

  if (!checkOrderOwnership(order.guest_telegram_user_id, auth.user.id)) {
    return json({ error: "forbidden" }, 403);
  }

  const { data: items } = await db
    .from("order_items")
    .select("product_name_snapshot, unit_price_snapshot, quantity, modifiers_snapshot, line_total")
    .eq("order_id", order.id);

  const { guest_telegram_user_id, ...orderView } = order;
  return json({ order: orderView, items: items ?? [] });
});
