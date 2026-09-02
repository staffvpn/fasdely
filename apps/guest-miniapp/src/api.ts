import { getInitData } from "./telegram.ts";

const BASE_URL = "https://rlxbhbdcecrnykwxnqtx.supabase.co/functions/v1";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; reason?: string };

export interface GetMenuResponse {
  location: { id: string; name: string; timezone: string; workingHours: unknown; defaultPrepTimeMinutes: number };
  categories: { id: string; name: string; icon: string | null; sort_order: number }[];
  products: {
    id: string;
    category_id: string | null;
    name: string;
    description: string | null;
    price: number;
    image_url: string | null;
    badges: string[];
  }[];
}

export interface CartItemInput {
  product_id: string;
  quantity: number;
  modifier_ids: string[];
}

export interface CreateOrderInput {
  locationId: string;
  tableId?: string | null;
  orderType: "dine_in" | "takeaway";
  requestedTimeMode: "asap" | "scheduled";
  requestedTime?: string | null;
  comment?: string | null;
  idempotencyKey: string;
  items: CartItemInput[];
}

export interface OrderSummary {
  id: string;
  order_number: number;
  status: string;
  total: number;
}

export interface OrderDetail extends OrderSummary {
  order_type: string;
  requested_time_mode: string;
  requested_time: string | null;
  comment: string | null;
  subtotal: number;
  currency: string;
  created_at: string;
}

export interface OrderItemView {
  product_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  modifiers_snapshot: { id: string; name: string; price_delta: number }[];
  line_total: number;
}

async function parseJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return { error: "unknown_error" };
  }
}

async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) return { ok: false, error: json.error ?? "unknown_error", reason: json.reason };
  return { ok: true, data: json };
}

export async function getMenu(qrToken: string): Promise<ApiResult<GetMenuResponse>> {
  const res = await fetch(`${BASE_URL}/get-menu?qr_token=${encodeURIComponent(qrToken)}`);
  const json = await parseJsonSafe(res);
  if (!res.ok) return { ok: false, error: json.error ?? "unknown_error" };
  return { ok: true, data: json };
}

export function createOrder(input: CreateOrderInput): Promise<ApiResult<{ order: OrderSummary }>> {
  return post("create-order", {
    init_data: getInitData(),
    location_id: input.locationId,
    table_id: input.tableId ?? null,
    order_type: input.orderType,
    requested_time_mode: input.requestedTimeMode,
    requested_time: input.requestedTime ?? null,
    comment: input.comment ?? null,
    idempotency_key: input.idempotencyKey,
    items: input.items,
  });
}

export function cancelOrder(orderId: string, reason?: string): Promise<ApiResult<{ order: OrderSummary }>> {
  return post("cancel-order", { init_data: getInitData(), order_id: orderId, reason });
}

export function getOrder(orderId: string): Promise<ApiResult<{ order: OrderDetail; items: OrderItemView[] }>> {
  return post("get-order", { init_data: getInitData(), order_id: orderId });
}
