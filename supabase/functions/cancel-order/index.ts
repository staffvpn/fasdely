import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyTelegramInitData } from "../_shared/telegramAuth.ts";
import type { OrderStatus } from "../_shared/orderStateMachine.ts";
import { json } from "../_shared/http.ts";
import { checkCancelAllowed } from "./logic.ts";

interface CancelBody {
  init_data: string;
  order_id: string;
  reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: CancelBody;
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
    .select("id, status, guest_telegram_user_id")
    .eq("id", body.order_id)
    .maybeSingle();
  if (!order) return json({ error: "order_not_found" }, 404);

  const { data: settingRow } = await db.from("platform_settings").select("value").eq("key", "cancellable_statuses").maybeSingle();
  const cancellableStatuses = ((settingRow?.value as OrderStatus[]) ?? ["new", "waiting_confirmation", "accepted"]);

  const check = checkCancelAllowed({
    order_status: order.status as OrderStatus,
    order_guest_telegram_user_id: order.guest_telegram_user_id,
    requesting_telegram_user_id: auth.user.id,
    cancellable_statuses: cancellableStatuses,
  });
  if (!check.ok) return json({ error: check.reason }, check.reason === "forbidden" ? 403 : 422);

  const { data: updated, error: updateError } = await db
    .from("orders")
    .update({ status: "cancelled_by_guest" })
    .eq("id", order.id)
    .eq("status", order.status)
    .select()
    .maybeSingle();
  if (updateError) return json({ error: "update_failed" }, 500);
  if (!updated) return json({ error: "already_handled" }, 409);

  await db.from("order_events").insert({
    order_id: order.id,
    event_type: "cancellation",
    from_status: order.status,
    to_status: "cancelled_by_guest",
    actor_type: "guest",
    actor_id: String(auth.user.id),
    reason: body.reason ?? null,
  });

  return json({ order: updated });
});
