import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canStaffTransition, type OrderStatus } from "../_shared/orderStateMachine.ts";
import { json } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  // Validate the caller's Supabase session with the anon key + forwarded
  // Authorization header (so auth.getUser() enforces the JWT properly).
  const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  // Do the actual DB work with the service role: this function performs its
  // own authorization checks below rather than relying on RLS.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: profile } = await db.from("profiles").select("role, location_id").eq("id", userData.user.id).maybeSingle();
  if (!profile || !["staff", "fasdely_operator", "fasdely_admin"].includes(profile.role)) {
    return json({ error: "forbidden" }, 403);
  }

  let body: { order_id: string; to_status: OrderStatus };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.order_id || !body.to_status) return json({ error: "invalid_request" }, 400);

  const { data: order } = await db.from("orders").select("id, location_id, status").eq("id", body.order_id).maybeSingle();
  if (!order) return json({ error: "order_not_found" }, 404);

  if (profile.role === "staff" && order.location_id !== profile.location_id) {
    return json({ error: "forbidden" }, 403);
  }

  if (!canStaffTransition(order.status as OrderStatus, body.to_status)) {
    return json({ error: "invalid_transition", from: order.status, to: body.to_status }, 422);
  }

  // Conditional UPDATE: only succeeds if status still matches what we just
  // read, so a second concurrent request for the same order becomes a no-op
  // instead of double-processing it.
  const { data: updated, error: updateError } = await db
    .from("orders")
    .update({ status: body.to_status })
    .eq("id", order.id)
    .eq("status", order.status)
    .select()
    .maybeSingle();

  if (updateError) return json({ error: "update_failed" }, 500);
  if (!updated) return json({ error: "already_handled" }, 409);

  await db.from("order_events").insert({
    order_id: order.id,
    event_type: "status_change",
    from_status: order.status,
    to_status: body.to_status,
    actor_type: "staff",
    actor_id: userData.user.id,
  });

  return json({ order: updated });
});
