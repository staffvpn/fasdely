# Guest Mini App + Bot Self-Serve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the guest-facing Telegram Mini App (menu → product → cart → checkout → confirmation → tracking) and extend the bot with a narrow, inline-keyboard self-serve path for staff/owners to toggle stop-list and edit price at their own location.

**Architecture:** Backend additions live in the existing `fasdely` Supabase project (new migration, an extended `get-menu`, a new `get-order` Edge Function, an extended `telegram-webhook`) — all following the exact conventions established in Backend Foundation (pure `logic.ts` + thin `index.ts`, Vitest, deploy via Supabase MCP). The guest Mini App is a new static Vite + vanilla TypeScript site in `apps/guest-miniapp/`, deployed to Cloudflare Pages, styled from the already-approved design system with real (non-base64) font files and DOM built via a small `h()` hyperscript helper — never `innerHTML` with user-supplied text, so product names/comments can never inject markup.

**Tech Stack:** Deno Edge Functions (existing), Postgres/Supabase (existing), Vite + TypeScript (new, guest-miniapp), Vitest (existing pattern, reused for the new app), Cloudflare Pages (new hosting target).

**Spec:** `docs/superpowers/specs/2026-08-31-guest-miniapp-design.md`

## Global Constraints

- Zero paid infrastructure — Supabase Free tier + Cloudflare Pages Free tier only.
- Guests never get a Supabase Auth account. Every guest-facing write/read is authorized via Telegram `initData`, verified server-side by the existing `verifyTelegramInitData` (`supabase/functions/_shared/telegramAuth.ts`) — never trust client-supplied identity.
- Order prices are always recomputed server-side (`create-order`, already shipped) — the Mini App's own cart total is display-only.
- Self-serve stop-list/price writes are scoped to the acting staff/owner's own business+location — never business-wide from a location-scoped staff member (see Task 1's `staff_set_stop`/`staff_set_price` design).
- Every self-serve write lands in `audit_log` with the correct human actor (not `NULL`), via the `fasdely.actor_id` transaction-local setting mechanism defined in Task 1.
- No free-text command parsing for self-serve — inline-keyboard callback queries only, per the design spec's explicit rejection of NLP-style matching.
- No client-side router in the Mini App — Telegram `BackButton` drives navigation, per the design spec.
- No Supabase Realtime for guest order tracking — polling only (design spec's explicit trade-off).
- All DOM text content (product names, descriptions, guest comments) is inserted as text nodes, never `innerHTML`, per the security doc's input-validation requirement.
- Supabase project: `fasdely`, project_id `rlxbhbdcecrnykwxnqtx`, region `eu-west-1`. All `apply_migration`/`deploy_edge_function`/`execute_sql` calls in this plan target this `project_id`.
- Repo: `C:\Users\User\projects\fasdely` (or a worktree of it). Backend tasks follow the existing `supabase/` layout; the new frontend lives in `apps/guest-miniapp/`.

---

## File Structure

```
fasdely/
├── supabase/
│   ├── migrations/
│   │   └── 0013_guest_miniapp_foundation.sql   # telegram_user_id, staff_set_stop/staff_set_price RPCs, log_audit_event actor fallback
│   └── functions/
│       ├── get-menu/
│       │   └── index.ts                        # MODIFY: accept qr_token, return location metadata
│       ├── get-order/                           # NEW
│       │   ├── logic.ts
│       │   ├── logic.test.ts
│       │   └── index.ts
│       └── telegram-webhook/
│           ├── logic.ts                         # MODIFY: add self-serve keyboard/callback logic
│           ├── logic.test.ts                    # MODIFY
│           └── index.ts                         # MODIFY: handle /меню, callback_query, price force-reply
├── apps/guest-miniapp/                          # NEW
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/fonts/*.woff2                     # 6 files, latin+cyrillic × Unbounded/Manrope
│   └── src/
│       ├── styles.css                           # ported design-system tokens, real @font-face
│       ├── dom.ts                                # h() hyperscript, formatPrice, icon registry
│       ├── telegram.ts                           # Telegram WebApp SDK wrapper
│       ├── telegram.test.ts
│       ├── api.ts                                # typed client for get-menu/create-order/cancel-order/get-order
│       ├── api.test.ts
│       ├── state.ts                              # cart store
│       ├── state.test.ts
│       ├── errors.ts                             # error-reason → guest-facing message
│       ├── errors.test.ts
│       ├── screens/
│       │   ├── menu.ts
│       │   ├── product.ts
│       │   ├── cart.ts
│       │   ├── checkout.ts
│       │   └── tracking.ts                       # confirmation + tracking share one polling screen
│       └── main.ts                               # boot sequence, view-state router, BackButton wiring
```

---

### Task 1: Self-serve backend foundation — telegram_user_id, staff RPCs, audit actor fallback

**Files:**
- Create: `supabase/migrations/0013_guest_miniapp_foundation.sql`

**Interfaces:**
- Consumes: `profiles`, `locations`, `products`, `product_location_overrides`, `stop_list`, `log_audit_event()` (all from Backend Foundation).
- Produces: column `profiles.telegram_user_id bigint unique`; functions `staff_set_stop(p_telegram_user_id bigint, p_location_id uuid, p_product_id uuid, p_stop boolean) returns jsonb` and `staff_set_price(p_telegram_user_id bigint, p_location_id uuid, p_product_id uuid, p_new_price numeric) returns jsonb`; `log_audit_event()` modified to honor a `fasdely.actor_id` transaction-local override.

**Design note (fills a gap the spec left implicit):** a location-scoped `staff` member's stop-list/price edits must apply to their own location only — a business-wide `products.base_price` edit or a `location_id = NULL` stop would incorrectly affect every location of the business. Both RPCs therefore take an explicit `p_location_id`, write `stop_list.location_id = p_location_id` (never NULL), and write price into `product_location_overrides` (per-location), never into `products.base_price`. A `business_owner` may act on any location of their own business; a `staff` member only on their own `profiles.location_id`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0013_guest_miniapp_foundation.sql`:

```sql
alter table profiles add column telegram_user_id bigint unique;

create or replace function staff_set_stop(p_telegram_user_id bigint, p_location_id uuid, p_product_id uuid, p_stop boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_business_id uuid;
begin
  select * into v_profile from profiles where telegram_user_id = p_telegram_user_id and status = 'active';
  if v_profile.id is null or v_profile.role not in ('staff', 'business_owner') then
    raise exception 'not_authorized' using errcode = '28000';
  end if;

  select business_id into v_business_id from locations where id = p_location_id;
  if v_business_id is null then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  if v_profile.role = 'staff' and v_profile.location_id is distinct from p_location_id then
    raise exception 'not_authorized' using errcode = '28000';
  end if;
  if v_profile.role = 'business_owner' and v_profile.business_id is distinct from v_business_id then
    raise exception 'not_authorized' using errcode = '28000';
  end if;

  if not exists (select 1 from products where id = p_product_id and business_id = v_business_id) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  perform set_config('fasdely.actor_id', v_profile.id::text, true);

  if p_stop then
    insert into stop_list (business_id, scope_type, scope_id, location_id, created_by)
    values (v_business_id, 'product', p_product_id, p_location_id, v_profile.id);
  else
    update stop_list
    set lifted_at = now()
    where business_id = v_business_id
      and scope_type = 'product'
      and scope_id = p_product_id
      and location_id = p_location_id
      and lifted_at is null;
  end if;

  return jsonb_build_object('ok', true, 'product_id', p_product_id, 'stopped', p_stop);
end;
$$;

create or replace function staff_set_price(p_telegram_user_id bigint, p_location_id uuid, p_product_id uuid, p_new_price numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_business_id uuid;
begin
  if p_new_price is null or p_new_price < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  select * into v_profile from profiles where telegram_user_id = p_telegram_user_id and status = 'active';
  if v_profile.id is null or v_profile.role not in ('staff', 'business_owner') then
    raise exception 'not_authorized' using errcode = '28000';
  end if;

  select business_id into v_business_id from locations where id = p_location_id;
  if v_business_id is null then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  if v_profile.role = 'staff' and v_profile.location_id is distinct from p_location_id then
    raise exception 'not_authorized' using errcode = '28000';
  end if;
  if v_profile.role = 'business_owner' and v_profile.business_id is distinct from v_business_id then
    raise exception 'not_authorized' using errcode = '28000';
  end if;

  if not exists (select 1 from products where id = p_product_id and business_id = v_business_id) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  perform set_config('fasdely.actor_id', v_profile.id::text, true);

  insert into product_location_overrides (product_id, location_id, price_override, is_available, is_published)
  values (p_product_id, p_location_id, p_new_price, true, true)
  on conflict (product_id, location_id)
  do update set price_override = excluded.price_override;

  return jsonb_build_object('ok', true, 'product_id', p_product_id, 'new_price', p_new_price);
end;
$$;

revoke execute on function staff_set_stop(bigint, uuid, uuid, boolean) from anon, authenticated;
revoke execute on function staff_set_price(bigint, uuid, uuid, numeric) from anon, authenticated;
grant execute on function staff_set_stop(bigint, uuid, uuid, boolean) to service_role, postgres;
grant execute on function staff_set_price(bigint, uuid, uuid, numeric) to service_role, postgres;
```

The `log_audit_event()` actor-fallback change is a separate, surgical step (Step 4 below) rather than pasted here — that function is large and already carries a `product_location_overrides` branch added in Backend Foundation's final hardening pass, so this plan fetches the live definition and patches only the two `auth.uid()`/`auth_role()` lines rather than risking a stale from-memory rewrite dropping a branch.

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tool `apply_migration` with `project_id` `rlxbhbdcecrnykwxnqtx`, `name` `guest_miniapp_foundation`, `query` = the file contents from Step 1.

- [ ] **Step 3: Verify the RPCs live**

```sql
-- Seed a business/location/product and a staff profile scoped to that location
with b as (
  insert into businesses (id, name) values ('11111111-0000-0000-0000-000000000001', '__selfserve_test_biz__') returning id
), l as (
  insert into locations (id, business_id, name) select '22222222-0000-0000-0000-000000000001', id, '__selfserve_test_loc__' from b returning id, business_id
), c as (
  insert into categories (business_id, name) select business_id, 'cat' from l returning id, business_id
), p as (
  insert into products (id, business_id, category_id, name, base_price, status)
  select '33333333-0000-0000-0000-000000000001', business_id, id, '__selfserve_test_product__', 280, 'published' from c returning id
)
select id from p;

insert into profiles (id, role, business_id, location_id, telegram_user_id, status)
values (gen_random_uuid(), 'staff', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 999888777, 'active');

-- staff stops the product at their own location
select staff_set_stop(999888777, '22222222-0000-0000-0000-000000000001'::uuid, '33333333-0000-0000-0000-000000000001'::uuid, true);
select scope_type, scope_id, location_id, lifted_at from stop_list where scope_id = '33333333-0000-0000-0000-000000000001'::uuid;

-- staff sets a location price override
select staff_set_price(999888777, '22222222-0000-0000-0000-000000000001'::uuid, '33333333-0000-0000-0000-000000000001'::uuid, 300);
select price_override from product_location_overrides where product_id = '33333333-0000-0000-0000-000000000001'::uuid;

-- audit_log picked up the correct actor (not NULL)
select entity_type, action, actor_id from audit_log where entity_id = '33333333-0000-0000-0000-000000000001'::uuid order by created_at desc limit 3;
```

Expected: `stop_list` row present with `location_id` set (not NULL) and `lifted_at` NULL; `product_location_overrides.price_override = 300.00`; `audit_log` rows show non-NULL `actor_id` matching the profile just created — **this last check only passes after Step 4's `log_audit_event()` patch, so run Step 3's authorization/scoping checks now and defer the `audit_log.actor_id` check until after Step 4**.

- [ ] **Step 4: Patch `log_audit_event()`'s actor resolution**

Fetch the live function definition to patch it safely rather than reproducing it from memory:

```sql
select pg_get_functiondef('log_audit_event'::regproc);
```

Read the result. Near the end of the function body there is an `insert into audit_log (...) values (...)` whose last two value expressions are `auth.uid()` and `auth_role()`. Construct a `create or replace function log_audit_event() ...` statement that is **byte-for-byte identical to the fetched definition**, except replacing those exact two trailing values with:

```sql
    coalesce(nullif(current_setting('fasdely.actor_id', true), '')::uuid, auth.uid()),
    coalesce(
      (select role from profiles where id = nullif(current_setting('fasdely.actor_id', true), '')::uuid),
      auth_role()
    )
```

Do not alter any other part of the function — every existing branch (the `stop_list` special-case, the `product_location_overrides` branch, and the shared generic branch for products/categories/promotions/seasonal_collections) must remain exactly as fetched. Apply the patched function via `apply_migration` with `name` `log_audit_event_actor_fallback`.

- [ ] **Step 5: Verify the audit actor fallback**

Re-run only the last query from Step 3:

```sql
select entity_type, action, actor_id from audit_log where entity_id = '33333333-0000-0000-0000-000000000001'::uuid order by created_at desc limit 3;
```

Expected: `actor_id` on the `stop_list` and `product_location_overrides` audit rows created in Step 3 matches the seeded profile's `id` (not NULL). If Step 3's rows predate this patch and show NULL, re-run Step 3's two `select staff_set_...(...)` calls now and check the newly-created rows instead.

- [ ] **Step 6: Clean up**

```sql
delete from businesses where name = '__selfserve_test_biz__';
delete from profiles where telegram_user_id = 999888777;
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0013_guest_miniapp_foundation.sql
git commit -m "feat: telegram_user_id, staff_set_stop/staff_set_price RPCs, audit actor fallback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Extend `get-menu` for QR-token resolution

**Files:**
- Modify: `supabase/functions/get-menu/index.ts`

**Interfaces:**
- Consumes: `buildMenu` (unchanged, from Backend Foundation's `get-menu/logic.ts`).
- Produces: `get-menu` now accepts `?qr_token=<token>` as an alternative to `?location_id=<uuid>`; response shape becomes `{ location: { id, name, timezone, workingHours, defaultPrepTimeMinutes }, categories, products }` (previously `{ categories, products }`).

- [ ] **Step 1: Modify `index.ts`**

Replace the location-lookup section (currently `.eq("id", locationId)`) with logic that branches on which query param was supplied, and wrap the response:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildMenu, type ProductRow, type StopRow } from "./logic.ts";
import { json } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
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
```

`logic.ts` is unchanged — `buildMenu`'s pure filtering logic doesn't care how the location was resolved.

- [ ] **Step 2: Redeploy**

Use `deploy_edge_function` — `project_id` `rlxbhbdcecrnykwxnqtx`, `name` `get-menu`, `entrypoint_path` `index.ts`, `verify_jwt` `false` (unchanged), `files`: the modified `index.ts`, the unchanged `logic.ts`, and `_shared/http.ts`.

- [ ] **Step 3: Smoke-test both query modes**

Seed one business/location/product (same pattern as Backend Foundation's `get-menu` smoke test), note the real `qr_token` value from the `locations` row you created, then:

```bash
curl -s "https://rlxbhbdcecrnykwxnqtx.supabase.co/functions/v1/get-menu?location_id=<location_id>"
curl -s "https://rlxbhbdcecrnykwxnqtx.supabase.co/functions/v1/get-menu?qr_token=<qr_token>"
```

Expected: both return the same menu, wrapped in a `location` object containing the seeded location's `id`, `name`, `timezone`, `workingHours`, `defaultPrepTimeMinutes`. Clean up the seed business afterward.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/get-menu/index.ts
git commit -m "feat: get-menu accepts qr_token, returns location metadata

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: New Edge Function `get-order`

**Files:**
- Create: `supabase/functions/get-order/logic.ts`
- Create: `supabase/functions/get-order/logic.test.ts`
- Create: `supabase/functions/get-order/index.ts`

**Interfaces:**
- Consumes: `verifyTelegramInitData` (`_shared/telegramAuth.ts`), `json` (`_shared/http.ts`).
- Produces: `checkOrderOwnership(orderGuestTelegramUserId: number, requestingTelegramUserId: number): boolean`; deployed function `POST /functions/v1/get-order`.

- [ ] **Step 1: Write the failing test**

`supabase/functions/get-order/logic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkOrderOwnership } from "./logic.ts";

describe("checkOrderOwnership", () => {
  it("allows the owning guest", () => {
    expect(checkOrderOwnership(111, 111)).toBe(true);
  });
  it("denies a different guest", () => {
    expect(checkOrderOwnership(111, 222)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/get-order`
Expected: FAIL — `./logic.ts` doesn't exist.

- [ ] **Step 3: Implement `logic.ts`**

```ts
export function checkOrderOwnership(orderGuestTelegramUserId: number, requestingTelegramUserId: number): boolean {
  return orderGuestTelegramUserId === requestingTelegramUserId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/get-order`
Expected: PASS.

- [ ] **Step 5: Implement `index.ts`**

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyTelegramInitData } from "../_shared/telegramAuth.ts";
import { json } from "../_shared/http.ts";
import { checkOrderOwnership } from "./logic.ts";

interface GetOrderBody {
  init_data: string;
  order_id: string;
}

Deno.serve(async (req: Request) => {
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
```

- [ ] **Step 6: Deploy the function**

Use `deploy_edge_function` — `project_id` `rlxbhbdcecrnykwxnqtx`, `name` `get-order`, `entrypoint_path` `index.ts`, `verify_jwt` `false` (guest auth is via Telegram `initData`), `files`: `index.ts`, `logic.ts`, `_shared/telegramAuth.ts`, `_shared/http.ts`.

- [ ] **Step 7: Smoke-test ownership enforcement**

Seed a business/location/product and place a real order via `create-order` (or insert an `orders` row directly with a known `guest_telegram_user_id`, e.g. `555111222`), then:

```bash
curl -s -X POST "https://rlxbhbdcecrnykwxnqtx.supabase.co/functions/v1/get-order" \
  -H "Content-Type: application/json" \
  -d '{"init_data": "<a validly-signed initData string for telegram user 555111222>", "order_id": "<order_id>"}'
```

Producing a validly-signed `initData` string requires the real `TELEGRAM_BOT_TOKEN` — if that secret is still the placeholder from Backend Foundation, this live HTTP round-trip cannot be fully exercised yet. In that case, verify the ownership logic itself was already covered by Step 1-4's unit test, and note in the commit that end-to-end verification is deferred to when a real bot token is configured (same deferred-manual-step pattern Backend Foundation already documented for `create-order`/`cancel-order`/`telegram-webhook`).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/get-order/
git commit -m "feat: get-order edge function for guest order-status polling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Extend `telegram-webhook` — self-serve stop-list & price

**Files:**
- Modify: `supabase/functions/telegram-webhook/logic.ts`
- Modify: `supabase/functions/telegram-webhook/logic.test.ts`
- Modify: `supabase/functions/telegram-webhook/index.ts`

**Interfaces:**
- Consumes: `staff_set_stop`, `staff_set_price` (Task 1, called via `db.rpc(...)`).
- Produces: `parseMenuCommand(text: string | undefined): boolean` (true if the message is `/меню` or `/меню@BotUsername`); `parseCallbackData(data: string): { action: "stop" | "unstop" | "price"; productId: string } | null`; `buildProductListKeyboard(products: { id: string; name: string; priceLabel: string; isStopped: boolean }[]): TelegramInlineKeyboard`; `parsePriceReplyContext(replyToText: string | undefined): string | null` (extracts a product id embedded in a bot-sent prompt message, or null if the reply isn't answering a price prompt).

**Design note:** conversation state for "waiting for a numeric price reply" is carried in the *message text itself* (the bot's own prompt embeds the product id as `#pid:<uuid>`, and Telegram's `message.reply_to_message.text` echoes it back) rather than a new stateful table — keeps this feature stateless and infra-free, consistent with the zero-new-infrastructure constraint.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/telegram-webhook/logic.test.ts` (the existing `parseStartCommand`/`buildMiniAppDeepLink` tests and their imports stay unchanged above this):

```ts
import { parseMenuCommand, parseCallbackData, buildProductListKeyboard, parsePriceReplyContext } from "./logic.ts";

describe("parseMenuCommand", () => {
  it("recognizes /меню", () => {
    expect(parseMenuCommand("/меню")).toBe(true);
  });
  it("recognizes /меню@BotUsername", () => {
    expect(parseMenuCommand("/меню@FasdelyBot")).toBe(true);
  });
  it("rejects unrelated text", () => {
    expect(parseMenuCommand("привет")).toBe(false);
  });
  it("rejects undefined", () => {
    expect(parseMenuCommand(undefined)).toBe(false);
  });
});

describe("parseCallbackData", () => {
  it("parses a stop action", () => {
    expect(parseCallbackData("stop:abc-123")).toEqual({ action: "stop", productId: "abc-123" });
  });
  it("parses an unstop action", () => {
    expect(parseCallbackData("unstop:abc-123")).toEqual({ action: "unstop", productId: "abc-123" });
  });
  it("parses a price action", () => {
    expect(parseCallbackData("price:abc-123")).toEqual({ action: "price", productId: "abc-123" });
  });
  it("returns null for malformed data", () => {
    expect(parseCallbackData("nonsense")).toBeNull();
  });
});

describe("buildProductListKeyboard", () => {
  it("builds one row per product with stop/price buttons", () => {
    const kb = buildProductListKeyboard([
      { id: "p1", name: "Капучино", priceLabel: "280 ₽", isStopped: false },
      { id: "p2", name: "Чизкейк", priceLabel: "320 ₽", isStopped: true },
    ]);
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[0][0].text).toContain("Капучино");
    expect(kb.inline_keyboard[0][0].callback_data).toBe("price:p1");
    expect(kb.inline_keyboard[0][1].callback_data).toBe("stop:p1");
    expect(kb.inline_keyboard[1][1].callback_data).toBe("unstop:p2");
  });
});

describe("parsePriceReplyContext", () => {
  it("extracts the embedded product id", () => {
    expect(parsePriceReplyContext("Введите новую цену для Капучино\n\n#pid:abc-123")).toBe("abc-123");
  });
  it("returns null when there is no embedded id", () => {
    expect(parsePriceReplyContext("просто сообщение")).toBeNull();
  });
  it("returns null for undefined", () => {
    expect(parsePriceReplyContext(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/telegram-webhook`
Expected: FAIL — the four new exports don't exist yet.

- [ ] **Step 3: Implement the additions in `logic.ts`**

Append to the existing `supabase/functions/telegram-webhook/logic.ts` (the existing `ParsedStartCommand`/`parseStartCommand`/`buildMiniAppDeepLink` stay unchanged above this):

```ts
export interface TelegramInlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export function parseMenuCommand(text: string | undefined): boolean {
  if (!text) return false;
  return /^\/меню(?:@\w+)?$/.test(text.trim());
}

export interface ParsedCallbackData {
  action: "stop" | "unstop" | "price";
  productId: string;
}

export function parseCallbackData(data: string): ParsedCallbackData | null {
  const match = /^(stop|unstop|price):(.+)$/.exec(data);
  if (!match) return null;
  return { action: match[1] as ParsedCallbackData["action"], productId: match[2] };
}

export interface ProductListEntry {
  id: string;
  name: string;
  priceLabel: string;
  isStopped: boolean;
}

export function buildProductListKeyboard(products: ProductListEntry[]): TelegramInlineKeyboard {
  return {
    inline_keyboard: products.map((p) => [
      { text: `${p.name} — ${p.priceLabel}`, callback_data: `price:${p.id}` },
      {
        text: p.isStopped ? "Включить" : "Стоп",
        callback_data: p.isStopped ? `unstop:${p.id}` : `stop:${p.id}`,
      },
    ]),
  };
}

export function parsePriceReplyContext(replyToText: string | undefined): string | null {
  if (!replyToText) return null;
  const match = /#pid:(\S+)/.exec(replyToText);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/telegram-webhook`
Expected: PASS — all tests, old and new.

- [ ] **Step 5: Extend `index.ts`**

Replace the body of the existing `Deno.serve(async (req: Request) => { ... })` in `supabase/functions/telegram-webhook/index.ts` with a version that keeps the existing secret-check and `/start` handling unchanged, and adds branches for `/меню`, `callback_query`, and price-reply messages:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseStartCommand,
  buildMiniAppDeepLink,
  parseMenuCommand,
  parseCallbackData,
  buildProductListKeyboard,
  parsePriceReplyContext,
  type ProductListEntry,
} from "./logic.ts";

async function sendMessage(botToken: string, chatId: number, text: string, replyMarkup?: unknown) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
  });
}

async function answerCallback(botToken: string, callbackQueryId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME")!;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const update = await req.json();

  // --- existing /start deep-link handling ---
  const message = update.message;
  const startParsed = parseStartCommand(message?.text);
  if (startParsed && message?.chat?.id) {
    let responseText = "Добро пожаловать в FASDELY! Откройте меню, чтобы сделать заказ.";
    if (startParsed.payload) {
      const { data: location } = await db
        .from("locations")
        .select("name, status")
        .eq("qr_token", startParsed.payload)
        .maybeSingle();
      if (location && location.status === "active") {
        responseText = `Добро пожаловать в ${location.name}! Откройте меню, чтобы сделать заказ.`;
      }
    }
    await sendMessage(botToken, message.chat.id, responseText, {
      inline_keyboard: [[{ text: "Открыть меню", web_app: { url: buildMiniAppDeepLink(botUsername, startParsed.payload) } }]],
    });
    return new Response("ok", { status: 200 });
  }

  // --- self-serve: /меню ---
  if (parseMenuCommand(message?.text) && message?.from?.id && message?.chat?.id) {
    const { data: profile } = await db
      .from("profiles")
      .select("id, role, business_id, location_id")
      .eq("telegram_user_id", message.from.id)
      .eq("status", "active")
      .maybeSingle();

    if (!profile || !["staff", "business_owner"].includes(profile.role)) {
      await sendMessage(botToken, message.chat.id, "Эта команда доступна только сотрудникам подключённого кафе.");
      return new Response("ok", { status: 200 });
    }

    let locationId = profile.location_id as string | null;
    if (!locationId) {
      // business_owner with no single location: for MVP, require exactly one location or ask them to contact FASDELY.
      const { data: locations } = await db.from("locations").select("id, name").eq("business_id", profile.business_id);
      if (!locations || locations.length !== 1) {
        await sendMessage(botToken, message.chat.id, "У вас несколько точек — выбор точки для самообслуживания пока не поддержан ботом, напишите нам напрямую.");
        return new Response("ok", { status: 200 });
      }
      locationId = locations[0].id;
    }

    const { data: products } = await db
      .from("products")
      .select("id, name, base_price, product_location_overrides!left(location_id, price_override)")
      .eq("business_id", profile.business_id)
      .eq("status", "published")
      .limit(20);

    const { data: stops } = await db
      .from("stop_list")
      .select("scope_id")
      .eq("business_id", profile.business_id)
      .eq("scope_type", "product")
      .eq("location_id", locationId)
      .is("lifted_at", null);
    const stoppedIds = new Set((stops ?? []).map((s) => s.scope_id));

    const entries: ProductListEntry[] = (products ?? []).map((p: any) => {
      const override = (p.product_location_overrides ?? []).find((o: any) => o.location_id === locationId);
      const price = override?.price_override ?? p.base_price;
      return { id: p.id, name: p.name, priceLabel: `${price} ₽`, isStopped: stoppedIds.has(p.id) };
    });

    await sendMessage(botToken, message.chat.id, "Меню вашей точки:", buildProductListKeyboard(entries));
    return new Response("ok", { status: 200 });
  }

  // --- self-serve: price reply (guest replies to the bot's "введите цену" prompt) ---
  if (message?.reply_to_message && message?.from?.id && message?.chat?.id) {
    const productId = parsePriceReplyContext(message.reply_to_message.text);
    if (productId) {
      const newPrice = Number(message.text?.replace(",", "."));
      if (!Number.isFinite(newPrice) || newPrice < 0) {
        await sendMessage(botToken, message.chat.id, "Не понял цену. Введите число, например 320.");
        return new Response("ok", { status: 200 });
      }
      const { data: profile } = await db
        .from("profiles")
        .select("location_id")
        .eq("telegram_user_id", message.from.id)
        .eq("status", "active")
        .maybeSingle();
      const locationId = profile?.location_id;
      if (!locationId) {
        await sendMessage(botToken, message.chat.id, "Не удалось определить вашу точку.");
        return new Response("ok", { status: 200 });
      }
      const { error } = await db.rpc("staff_set_price", {
        p_telegram_user_id: message.from.id,
        p_location_id: locationId,
        p_product_id: productId,
        p_new_price: newPrice,
      });
      await sendMessage(botToken, message.chat.id, error ? `Не удалось изменить цену: ${error.message}` : `Готово, новая цена: ${newPrice} ₽.`);
      return new Response("ok", { status: 200 });
    }
  }

  // --- self-serve: callback query (stop / unstop / price button) ---
  const callback = update.callback_query;
  if (callback?.data && callback?.from?.id) {
    const parsed = parseCallbackData(callback.data);
    if (parsed) {
      const { data: profile } = await db
        .from("profiles")
        .select("location_id")
        .eq("telegram_user_id", callback.from.id)
        .eq("status", "active")
        .maybeSingle();
      const locationId = profile?.location_id;

      if (!locationId) {
        await answerCallback(botToken, callback.id, "Не удалось определить вашу точку.");
        return new Response("ok", { status: 200 });
      }

      if (parsed.action === "price") {
        await sendMessage(botToken, callback.message.chat.id, `Введите новую цену\n\n#pid:${parsed.productId}`, { force_reply: true });
        await answerCallback(botToken, callback.id);
        return new Response("ok", { status: 200 });
      }

      const { error } = await db.rpc("staff_set_stop", {
        p_telegram_user_id: callback.from.id,
        p_location_id: locationId,
        p_product_id: parsed.productId,
        p_stop: parsed.action === "stop",
      });
      await answerCallback(botToken, callback.id, error ? `Ошибка: ${error.message}` : "Готово");
      return new Response("ok", { status: 200 });
    }
  }

  return new Response("ok", { status: 200 });
});
```

- [ ] **Step 6: Redeploy**

Use `deploy_edge_function` — `project_id` `rlxbhbdcecrnykwxnqtx`, `name` `telegram-webhook`, `entrypoint_path` `index.ts`, `verify_jwt` `false` (unchanged), `files`: `index.ts`, `logic.ts`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/telegram-webhook/
git commit -m "feat: bot self-serve stop-list/price via inline keyboards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Scaffold the guest Mini App

**Files:**
- Create: `apps/guest-miniapp/package.json`
- Create: `apps/guest-miniapp/vite.config.ts`
- Create: `apps/guest-miniapp/tsconfig.json`
- Create: `apps/guest-miniapp/index.html`
- Create: `apps/guest-miniapp/public/fonts/unbounded-700-latin.woff2`
- Create: `apps/guest-miniapp/public/fonts/unbounded-700-cyrillic.woff2`
- Create: `apps/guest-miniapp/public/fonts/manrope-400-latin.woff2`
- Create: `apps/guest-miniapp/public/fonts/manrope-400-cyrillic.woff2`
- Create: `apps/guest-miniapp/public/fonts/manrope-700-latin.woff2`
- Create: `apps/guest-miniapp/public/fonts/manrope-700-cyrillic.woff2`
- Create: `apps/guest-miniapp/src/styles.css`

**Interfaces:**
- Produces: a `npm run build` command producing a static `dist/` deployable to Cloudflare Pages; CSS custom properties (`--m-ink`, `--m-coral`, `--m-pine`, etc.) and component classes (`.p-card`, `.cart-row`, `.ticket`, `.btn`, `.chip`, `.co-opt`, `.track-item`, ...) that later tasks' screens use — same class names as `docs/design/fasdely-design-system.html`'s mockup, ported here as the real stylesheet.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "fasdely-guest-miniapp",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `vite.config.ts`**

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist" },
});
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>FASDELY</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Download the font files**

Fetch the same 6 subset files established in the design-system pass (latin + cyrillic, Unbounded 700 and Manrope 400/700) directly from Google Fonts, and save them into `apps/guest-miniapp/public/fonts/` with these exact filenames: `unbounded-700-latin.woff2`, `unbounded-700-cyrillic.woff2`, `manrope-400-latin.woff2`, `manrope-400-cyrillic.woff2`, `manrope-700-latin.woff2`, `manrope-700-cyrillic.woff2`. Fetch the CSS to get current URLs:

```bash
curl -s "https://fonts.googleapis.com/css2?family=Unbounded:wght@700&family=Manrope:wght@400;700&display=swap" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
```

For each of the 6 `@font-face` blocks in the response matching `Unbounded`/weight 700 or `Manrope`/weight 400 or 700, note whether its `unicode-range` starts with `U+0000-00FF` (latin) or `U+0400-045F` (cyrillic, may be prefixed with `U+0301,`), then `curl -s -o public/fonts/<exact-filename-above>.woff2 "<the src url from that block>"`.

**Unlike the design-system mockup, do NOT base64-embed these** — real font files served from `public/fonts/` load faster and don't bloat the JS bundle; base64-inlining was only necessary there because Artifacts must be a single self-contained file.

- [ ] **Step 6: Write `src/styles.css`**

Port the design tokens and component classes from `docs/design/fasdely-design-system.html`'s `--m-*` custom properties and every one of these rule blocks verbatim (same selectors, same property values — that CSS was already reviewed and approved): `.p-grid`; `.p-card` and its `__img`/`__badge`/`__body`/`__name`/`__desc`/`__price` children; `.pd-hero` and `.pd-hero__back`; `.pd-body`/`.pd-title`/`.pd-price`/`.pd-desc`; `.cart-row` and its `__thumb`/`__main`/`__name`/`__mods`/`__bottom`/`__price`/`__remove` children plus `.cart-stepper` and its `__btn`/`__n` children; `.ticket` and its `::before`/`::after`/`.t-line`/`.t-sub`/`.t-total` children; `.pay-pill`; `.btn`/`.btn--secondary`/`.btn--pine`/`.btn--block`; `.chip`/`.chips`; `.co-opt`/`.co-toggle`/`.co-time`/`.co-field`; `.track-list`/`.track-item`/`.track-dot`/`.track-label`/`.track-time` including the `is-done`/`is-current` state selectors and the `pulse`/`pop` keyframe animations; `.cancel-note`; `.success-check`/`.success-title`/`.success-sub`; `.mod-group`/`.mod-opt`/`.radio`/`.qty`/`.qty__btn`; `.sticky-cta`/`__info`/`__price`; `.app-header`/`__top`/`__name`/`__meta`/`.dot`; `.scroller`; `.icon-btn`; `.seasonal-card` (unused by any screen in this plan but harmless to keep for parity); `.grad-1`–`.grad-4`; `.screen`/`.grabber`; the `prefers-reduced-motion` block. With two changes: (1) replace the `@font-face` blocks' base64 `src: url(data:font/woff2;base64,...)` with real file references:

```css
@font-face {
  font-family: 'FD Unbounded';
  font-weight: 700;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  src: url('/fonts/unbounded-700-latin.woff2') format('woff2');
}
@font-face {
  font-family: 'FD Unbounded';
  font-weight: 700;
  font-display: swap;
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
  src: url('/fonts/unbounded-700-cyrillic.woff2') format('woff2');
}
@font-face {
  font-family: 'FD Manrope';
  font-weight: 400;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  src: url('/fonts/manrope-400-latin.woff2') format('woff2');
}
@font-face {
  font-family: 'FD Manrope';
  font-weight: 400;
  font-display: swap;
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
  src: url('/fonts/manrope-400-cyrillic.woff2') format('woff2');
}
@font-face {
  font-family: 'FD Manrope';
  font-weight: 700;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  src: url('/fonts/manrope-700-latin.woff2') format('woff2');
}
@font-face {
  font-family: 'FD Manrope';
  font-weight: 700;
  font-display: swap;
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
  src: url('/fonts/manrope-700-cyrillic.woff2') format('woff2');
}
```

and (2) drop everything that was specific to the gallery/showcase chrome (`.wrap`, `.intro*`, `.section*`, `.swatch*`, `.type-*`, `.signature*`, `.rail`, `.device*`, `.screen` frame border-radius sizing meant for the phone-mockup illustration) — the real app fills the whole viewport, it isn't framed in a phone illustration. Keep every `--m-*` custom property and every component class listed above, plus:

```css
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body {
  background: var(--m-paper);
  color: var(--m-ink);
  font-family: 'FD Manrope', sans-serif;
  -webkit-font-smoothing: antialiased;
}
#app { display: flex; flex-direction: column; overflow: hidden; }
img { max-width: 100%; display: block; }
svg { display: block; }

/* The mockup's .p-card__img and .pd-hero were illustrated with flat gradient
   divs; the real app puts an actual <img> inside them when a product has a
   photo, so both containers need their image child to fill and crop properly. */
.p-card__img { overflow: hidden; }
.p-card__img img, .pd-hero img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

- [ ] **Step 7: Verify the build works**

```bash
cd apps/guest-miniapp
npm install
npm run build
```

Expected: succeeds, produces `dist/index.html` and bundled assets. `npx vitest run --passWithNoTests` also passes (no test files yet).

- [ ] **Step 8: Commit**

```bash
git add apps/guest-miniapp/
git commit -m "chore: scaffold guest Mini App (Vite + TS), port design tokens with real font files

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `dom.ts` — hyperscript helper, formatting, icons

**Files:**
- Create: `apps/guest-miniapp/src/dom.ts`
- Create: `apps/guest-miniapp/src/dom.test.ts`

**Interfaces:**
- Produces: `h(tag: string, attrs?: Record<string, string>, children?: (Node | string)[]): HTMLElement`; `formatPrice(rub: number): string`; `svgIcon(name: IconName): SVGSVGElement`; `type IconName = "search" | "back" | "plus" | "minus" | "close" | "check" | "card"`.

- [ ] **Step 1: Write the failing tests**

`apps/guest-miniapp/src/dom.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { h, formatPrice } from "./dom.ts";

describe("h", () => {
  it("creates an element with attributes and text children", () => {
    const el = h("div", { class: "p-card" }, ["hello"]);
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("p-card");
    expect(el.textContent).toBe("hello");
  });

  it("nests element children", () => {
    const inner = h("span", {}, ["inner"]);
    const outer = h("div", {}, [inner]);
    expect(outer.children).toHaveLength(1);
    expect(outer.firstElementChild).toBe(inner);
  });

  it("never interprets text as markup (XSS safety)", () => {
    const el = h("div", {}, ['<img src=x onerror="alert(1)">']);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror="alert(1)">');
  });
});

describe("formatPrice", () => {
  it("formats a whole ruble amount with the currency sign", () => {
    expect(formatPrice(280)).toBe("280 ₽");
  });
  it("groups thousands with a space", () => {
    expect(formatPrice(1842)).toBe("1 842 ₽");
  });
});
```

Note: this test file needs a DOM environment. Add `"environment": "jsdom"` is not set globally in the existing backend `vitest.config.ts` — this app's `vite.config.ts` doesn't configure a test environment yet either, so this step also requires adding a `test` block. Update `apps/guest-miniapp/vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist" },
  test: { environment: "jsdom" },
});
```

And add `jsdom` as a dev dependency in `package.json`'s `devDependencies`: `"jsdom": "^25.0.0"`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/guest-miniapp
npm install
npx vitest run
```

Expected: FAIL — `./dom.ts` doesn't exist.

- [ ] **Step 3: Implement `dom.ts`**

```ts
export function h(
  tag: string,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = []
): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") el.className = value;
    else el.setAttribute(key, value);
  }
  for (const child of children) {
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function formatPrice(rub: number): string {
  return `${rub.toLocaleString("ru-RU")} ₽`;
}

export type IconName = "search" | "back" | "plus" | "minus" | "close" | "check" | "card";

const ICON_PATHS: Record<IconName, string> = {
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>',
};

export function svgIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}
```

`svgIcon`'s `innerHTML` assignment is safe because `ICON_PATHS` values are a fixed internal constant, never user-supplied data — this is the one deliberate exception to the "never innerHTML" rule, and it's scoped to a closed set of 7 known-safe strings.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/guest-miniapp/src/dom.ts apps/guest-miniapp/src/dom.test.ts apps/guest-miniapp/vite.config.ts apps/guest-miniapp/package.json apps/guest-miniapp/package-lock.json
git commit -m "feat: dom.ts hyperscript helper, price formatting, icon registry

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `telegram.ts` — Telegram WebApp SDK wrapper

**Files:**
- Create: `apps/guest-miniapp/src/telegram.ts`
- Create: `apps/guest-miniapp/src/telegram.test.ts`

**Interfaces:**
- Produces: `getInitData(): string` (from `window.Telegram.WebApp.initData`); `getStartParam(): string | null` (from `window.Telegram.WebApp.initDataUnsafe.start_param`); `onBackButtonClick(handler: () => void): void`; `showBackButton(): void`; `hideBackButton(): void`; `ready(): void`; `expand(): void`; `parseThemeParams(raw: Record<string, string> | undefined): { bg: string; text: string } | null` (pure, tested separately from the `window.Telegram` access).

- [ ] **Step 1: Write the failing tests**

`apps/guest-miniapp/src/telegram.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseThemeParams } from "./telegram.ts";

describe("parseThemeParams", () => {
  it("extracts bg and text colors when present", () => {
    expect(parseThemeParams({ bg_color: "#ffffff", text_color: "#111111" })).toEqual({
      bg: "#ffffff",
      text: "#111111",
    });
  });
  it("returns null when theme params are absent", () => {
    expect(parseThemeParams(undefined)).toBeNull();
  });
  it("returns null when required keys are missing", () => {
    expect(parseThemeParams({ bg_color: "#ffffff" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/telegram.test.ts
```

Expected: FAIL — `./telegram.ts` doesn't exist.

- [ ] **Step 3: Implement `telegram.ts`**

```ts
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  themeParams?: Record<string, string>;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
  };
  ready(): void;
  expand(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

function webApp(): TelegramWebApp {
  const app = window.Telegram?.WebApp;
  if (!app) throw new Error("Telegram WebApp SDK not available — this page must be opened inside Telegram");
  return app;
}

export function getInitData(): string {
  return webApp().initData;
}

export function getStartParam(): string | null {
  return webApp().initDataUnsafe.start_param ?? null;
}

export function onBackButtonClick(handler: () => void): void {
  webApp().BackButton.onClick(handler);
}

export function showBackButton(): void {
  webApp().BackButton.show();
}

export function hideBackButton(): void {
  webApp().BackButton.hide();
}

export function ready(): void {
  webApp().ready();
}

export function expand(): void {
  webApp().expand();
}

export function parseThemeParams(raw: Record<string, string> | undefined): { bg: string; text: string } | null {
  if (!raw || !raw.bg_color || !raw.text_color) return null;
  return { bg: raw.bg_color, text: raw.text_color };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/telegram.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/guest-miniapp/src/telegram.ts apps/guest-miniapp/src/telegram.test.ts
git commit -m "feat: Telegram WebApp SDK wrapper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `api.ts` — typed backend client

**Files:**
- Create: `apps/guest-miniapp/src/api.ts`
- Create: `apps/guest-miniapp/src/api.test.ts`

**Interfaces:**
- Consumes: `getInitData` (Task 7).
- Produces: `type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; reason?: string }`; `getMenu(qrToken: string): Promise<ApiResult<GetMenuResponse>>`; `createOrder(input: CreateOrderInput): Promise<ApiResult<{ order: OrderSummary }>>`; `cancelOrder(orderId: string, reason?: string): Promise<ApiResult<{ order: OrderSummary }>>`; `getOrder(orderId: string): Promise<ApiResult<{ order: OrderDetail; items: OrderItemView[] }>>`.

- [ ] **Step 1: Write the failing tests**

`apps/guest-miniapp/src/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getMenu, createOrder } from "./api.ts";

vi.mock("./telegram.ts", () => ({ getInitData: () => "mock-init-data" }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("getMenu", () => {
  it("returns ok with the parsed response on success", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ location: { id: "loc-1", name: "Test" }, categories: [], products: [] }),
    });
    const result = await getMenu("qr-abc");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.location.id).toBe("loc-1");
    expect((fetch as any).mock.calls[0][0]).toContain("qr_token=qr-abc");
  });

  it("returns ok:false with the server's error reason on failure", async () => {
    (fetch as any).mockResolvedValue({ ok: false, json: async () => ({ error: "location_not_found" }) });
    const result = await getMenu("bad-token");
    expect(result).toEqual({ ok: false, error: "location_not_found" });
  });
});

describe("createOrder", () => {
  it("sends init_data from the telegram wrapper automatically", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ order: { id: "o1" } }) });
    await createOrder({
      locationId: "loc-1",
      orderType: "dine_in",
      requestedTimeMode: "asap",
      idempotencyKey: "key-1",
      items: [],
    });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.init_data).toBe("mock-init-data");
    expect(body.location_id).toBe("loc-1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/api.test.ts
```

Expected: FAIL — `./api.ts` doesn't exist.

- [ ] **Step 3: Implement `api.ts`**

```ts
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

async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) return { ok: false, error: json.error ?? "unknown_error", reason: json.reason };
  return { ok: true, data: json };
}

export async function getMenu(qrToken: string): Promise<ApiResult<GetMenuResponse>> {
  const res = await fetch(`${BASE_URL}/get-menu?qr_token=${encodeURIComponent(qrToken)}`);
  const json = await res.json();
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/guest-miniapp/src/api.ts apps/guest-miniapp/src/api.test.ts
git commit -m "feat: typed API client for get-menu/create-order/cancel-order/get-order

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `state.ts` — cart store

**Files:**
- Create: `apps/guest-miniapp/src/state.ts`
- Create: `apps/guest-miniapp/src/state.test.ts`

**Interfaces:**
- Produces: `interface CartLine { productId: string; name: string; unitPrice: number; quantity: number; modifierIds: string[]; modifierLabel: string }`; `class CartStore` with methods `add(line: CartLine): void`, `remove(productId: string, modifierIds: string[]): void`, `setQuantity(productId: string, modifierIds: string[], quantity: number): void`, `clear(): void`, `getLines(): CartLine[]`, `getTotal(): number`, `save(): void` (persists to `localStorage`), `static load(): CartStore`.

- [ ] **Step 1: Write the failing tests**

`apps/guest-miniapp/src/state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { CartStore } from "./state.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("CartStore", () => {
  it("adds a line and computes the total", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    expect(cart.getLines()).toHaveLength(1);
    expect(cart.getTotal()).toBe(280);
  });

  it("merges a second add of the same product+modifiers by summing quantity", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 2, modifierIds: [], modifierLabel: "" });
    expect(cart.getLines()).toHaveLength(1);
    expect(cart.getLines()[0].quantity).toBe(3);
  });

  it("treats the same product with different modifiers as separate lines", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 360, quantity: 1, modifierIds: ["m1"], modifierLabel: "Овсяное" });
    expect(cart.getLines()).toHaveLength(2);
  });

  it("setQuantity updates an existing line", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.setQuantity("p1", [], 5);
    expect(cart.getLines()[0].quantity).toBe(5);
  });

  it("setQuantity to 0 removes the line", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.setQuantity("p1", [], 0);
    expect(cart.getLines()).toHaveLength(0);
  });

  it("remove deletes a specific line", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.remove("p1", []);
    expect(cart.getLines()).toHaveLength(0);
  });

  it("clear empties the cart", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 1, modifierIds: [], modifierLabel: "" });
    cart.clear();
    expect(cart.getLines()).toHaveLength(0);
  });

  it("save then load round-trips through localStorage", () => {
    const cart = new CartStore();
    cart.add({ productId: "p1", name: "Капучино", unitPrice: 280, quantity: 2, modifierIds: [], modifierLabel: "" });
    cart.save();
    const reloaded = CartStore.load();
    expect(reloaded.getLines()).toEqual(cart.getLines());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/state.test.ts
```

Expected: FAIL — `./state.ts` doesn't exist.

- [ ] **Step 3: Implement `state.ts`**

```ts
export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  modifierIds: string[];
  modifierLabel: string;
}

const STORAGE_KEY = "fasdely-cart-v1";

function lineKey(productId: string, modifierIds: string[]): string {
  return `${productId}::${[...modifierIds].sort().join(",")}`;
}

export class CartStore {
  private lines: Map<string, CartLine> = new Map();

  add(line: CartLine): void {
    const key = lineKey(line.productId, line.modifierIds);
    const existing = this.lines.get(key);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      this.lines.set(key, { ...line });
    }
  }

  remove(productId: string, modifierIds: string[]): void {
    this.lines.delete(lineKey(productId, modifierIds));
  }

  setQuantity(productId: string, modifierIds: string[], quantity: number): void {
    const key = lineKey(productId, modifierIds);
    if (quantity <= 0) {
      this.lines.delete(key);
      return;
    }
    const existing = this.lines.get(key);
    if (existing) existing.quantity = quantity;
  }

  clear(): void {
    this.lines.clear();
  }

  getLines(): CartLine[] {
    return [...this.lines.values()];
  }

  getTotal(): number {
    return this.getLines().reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  }

  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.getLines()));
  }

  static load(): CartStore {
    const store = new CartStore();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return store;
    try {
      const lines: CartLine[] = JSON.parse(raw);
      for (const line of lines) store.lines.set(lineKey(line.productId, line.modifierIds), line);
    } catch {
      // corrupted storage — start with an empty cart rather than throwing
    }
    return store;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/guest-miniapp/src/state.ts apps/guest-miniapp/src/state.test.ts
git commit -m "feat: cart store with localStorage persistence

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `errors.ts` — guest-facing error messages

**Files:**
- Create: `apps/guest-miniapp/src/errors.ts`
- Create: `apps/guest-miniapp/src/errors.test.ts`

**Interfaces:**
- Produces: `getErrorMessage(error: string, reason?: string): string` implementing the exact mapping table from the design spec's Error Handling section.

- [ ] **Step 1: Write the failing tests**

`apps/guest-miniapp/src/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getErrorMessage } from "./errors.ts";

describe("getErrorMessage", () => {
  it("maps location_not_found", () => {
    expect(getErrorMessage("location_not_found")).toContain("не принимаем заказы");
  });
  it("maps product_unavailable", () => {
    expect(getErrorMessage("product_unavailable")).toContain("закончился");
  });
  it("maps unauthorized to the initData-refresh message", () => {
    expect(getErrorMessage("unauthorized")).toContain("Откройте меню заново");
  });
  it("maps invalid_time with a reason-specific detail", () => {
    expect(getErrorMessage("invalid_time", "too_soon")).toContain("время");
  });
  it("falls back to a generic message for unknown errors", () => {
    expect(getErrorMessage("something_never_seen_before")).toBe("Что-то пошло не так. Попробуйте ещё раз.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/errors.test.ts
```

Expected: FAIL — `./errors.ts` doesn't exist.

- [ ] **Step 3: Implement `errors.ts`**

```ts
const MESSAGES: Record<string, string> = {
  network_error: "Нет интернета. Проверьте подключение и попробуйте снова.",
  location_not_found: "Сейчас не принимаем заказы в этом заведении.",
  location_closed: "Сейчас не принимаем заказы. Загляните позже.",
  product_not_found: "Этот товар закончился. Уберём его из заказа?",
  product_unavailable: "Этот товар закончился. Уберём его из заказа?",
  modifier_not_found: "Этот вариант товара сейчас недоступен.",
  invalid_quantity: "Проверьте количество товара.",
  empty_cart: "Корзина пуста.",
  unauthorized: "Не удалось подтвердить, что это вы. Откройте меню заново из Telegram.",
  forbidden: "Это не ваш заказ.",
  order_not_found: "Заказ не найден.",
  not_cancellable: "Отмена уже недоступна — заказ готовится.",
  already_handled: "Заказ уже обработан.",
};

const TIME_REASONS: Record<string, string> = {
  too_soon: "Выберите время позже — на подготовку нужно больше времени.",
  outside_hours: "Выбранное время вне часов работы.",
  location_closed: "Сейчас не принимаем заказы. Загляните позже.",
};

export function getErrorMessage(error: string, reason?: string): string {
  if (error === "invalid_time" && reason && TIME_REASONS[reason]) return TIME_REASONS[reason];
  return MESSAGES[error] ?? "Что-то пошло не так. Попробуйте ещё раз.";
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/errors.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/guest-miniapp/src/errors.ts apps/guest-miniapp/src/errors.test.ts
git commit -m "feat: guest-facing error message mapping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Menu screen + boot sequence

**Files:**
- Create: `apps/guest-miniapp/src/screens/menu.ts`
- Modify: `apps/guest-miniapp/src/main.ts`

**Interfaces:**
- Consumes: `getMenu` (Task 8), `h`/`formatPrice`/`svgIcon` (Task 6), `getStartParam`/`ready`/`expand` (Task 7), `CartStore` (Task 9), `getErrorMessage` (Task 10).
- Produces: `renderMenuScreen(data: GetMenuResponse, onSelectProduct: (productId: string) => void, onContinue: () => void, cart: CartStore): HTMLElement`.

- [ ] **Step 1: Implement `screens/menu.ts`**

```ts
import { h, formatPrice, svgIcon } from "../dom.ts";
import type { GetMenuResponse } from "../api.ts";
import type { CartStore } from "../state.ts";

export function renderMenuScreen(
  data: GetMenuResponse,
  onSelectProduct: (productId: string) => void,
  onContinue: () => void,
  cart: CartStore
): HTMLElement {
  const header = h("div", { class: "app-header" }, [
    h("div", { class: "app-header__top" }, [
      h("div", {}, [
        h("div", { class: "app-header__name" }, [data.location.name]),
        h("div", { class: "app-header__meta" }, [h("span", { class: "dot" }, []), "Открыто"]),
      ]),
      h("div", { class: "icon-btn" }, [svgIcon("search")]),
    ]),
  ]);

  const grid = h(
    "div",
    { class: "p-grid" },
    data.products.map((p) => {
      const card = h("div", { class: "p-card" }, [
        h("div", { class: "p-card__img" }, p.image_url ? [h("img", { src: p.image_url })] : []),
        h("div", { class: "p-card__body" }, [
          h("div", { class: "p-card__name" }, [p.name]),
          h("div", { class: "p-card__desc" }, [p.description ?? ""]),
          h("div", { class: "p-card__price" }, [formatPrice(p.price)]),
        ]),
      ]);
      card.addEventListener("click", () => onSelectProduct(p.id));
      return card;
    })
  );

  const scroller = h("div", { class: "scroller" }, [grid]);

  const cartTotal = cart.getTotal();
  const cartCount = cart.getLines().reduce((sum, l) => sum + l.quantity, 0);
  const continueBtn = h("div", { class: "btn" }, ["Далее"]);
  continueBtn.addEventListener("click", onContinue);
  const sticky = h("div", { class: "sticky-cta" }, [
    h("div", { class: "sticky-cta__info" }, [
      `Корзина · ${cartCount} товар${cartCount === 1 ? "" : "а"}`,
      h("br", {}, []),
      h("span", { class: "sticky-cta__price" }, [formatPrice(cartTotal)]),
    ]),
    continueBtn,
  ]);

  const screen = h("div", { class: "screen" }, [header, scroller]);
  if (cartCount > 0) screen.append(sticky);
  return screen;
}
```

- [ ] **Step 2: Write `main.ts`**

```ts
import { ready, expand, getStartParam, showBackButton, hideBackButton, onBackButtonClick } from "./telegram.ts";
import { getMenu, type GetMenuResponse } from "./api.ts";
import { getErrorMessage } from "./errors.ts";
import { CartStore } from "./state.ts";
import { renderMenuScreen } from "./screens/menu.ts";
import { h } from "./dom.ts";

const app = document.getElementById("app")!;
const cart = CartStore.load();

function renderError(message: string) {
  app.replaceChildren(h("div", { class: "screen" }, [h("div", { class: "pd-body" }, [message])]));
}

async function boot() {
  ready();
  expand();

  const qrToken = getStartParam();
  if (!qrToken) {
    renderError("Не удалось определить заведение. Откройте FASDELY через QR-код в кафе.");
    return;
  }

  const result = await getMenu(qrToken);
  if (!result.ok) {
    renderError(getErrorMessage(result.error, result.reason));
    return;
  }

  showMenu(result.data);
}

function showMenu(data: GetMenuResponse) {
  hideBackButton();
  const screen = renderMenuScreen(
    data,
    (productId) => {
      // Task 12 wires product-detail navigation here.
    },
    () => {
      // Task 13 wires cart navigation here.
    },
    cart
  );
  app.replaceChildren(screen);
}

boot();
```

- [ ] **Step 3: Manual verification**

```bash
cd apps/guest-miniapp
npm run dev
```

Open the printed local URL in a desktop browser. This is a syntax/build smoke check only, not a functional one: outside Telegram, `window.Telegram` is undefined, so `boot()`'s call to `getStartParam()` will throw inside `webApp()` — that thrown error appearing in the browser console (rather than a bundler/syntax error at the `npm run dev` command itself) is the expected, correct signal that the file compiles and runs. Full functional verification requires a real Telegram client and is tracked in Task 16's manual E2E checklist — do not attempt to suppress or work around the error here.

- [ ] **Step 4: Commit**

```bash
git add apps/guest-miniapp/src/screens/menu.ts apps/guest-miniapp/src/main.ts
git commit -m "feat: menu screen and app boot sequence

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Product detail screen

**Files:**
- Create: `apps/guest-miniapp/src/screens/product.ts`
- Modify: `apps/guest-miniapp/src/main.ts`

**Interfaces:**
- Consumes: `h`/`formatPrice`/`svgIcon` (Task 6), `CartStore` (Task 9), product shape from `GetMenuResponse.products[number]` (Task 8).
- Produces: `renderProductScreen(product: GetMenuResponse["products"][number], onAddToCart: (quantity: number) => void, onBack: () => void): HTMLElement`.

- [ ] **Step 1: Implement `screens/product.ts`**

```ts
import { h, formatPrice, svgIcon } from "../dom.ts";
import type { GetMenuResponse } from "../api.ts";

export function renderProductScreen(
  product: GetMenuResponse["products"][number],
  onAddToCart: (quantity: number) => void,
  onBack: () => void
): HTMLElement {
  let quantity = 1;

  const backBtn = h("div", { class: "icon-btn pd-hero__back" }, [svgIcon("back")]);
  backBtn.addEventListener("click", onBack);
  const heroChildren: HTMLElement[] = [backBtn];
  if (product.image_url) heroChildren.unshift(h("img", { src: product.image_url, alt: product.name }));
  const hero = h("div", { class: "pd-hero" }, heroChildren);

  const qtyLabel = h("span", {}, [String(quantity)]);
  const minusBtn = h("span", { class: "qty__btn" }, [svgIcon("minus")]);
  const plusBtn = h("span", { class: "qty__btn" }, [svgIcon("plus")]);
  minusBtn.addEventListener("click", () => {
    if (quantity > 1) quantity -= 1;
    qtyLabel.textContent = String(quantity);
    updateAddButton();
  });
  plusBtn.addEventListener("click", () => {
    quantity += 1;
    qtyLabel.textContent = String(quantity);
    updateAddButton();
  });

  const addBtn = h("div", { class: "btn btn--block" }, [`Добавить в корзину — ${formatPrice(product.price)}`]);
  function updateAddButton() {
    addBtn.textContent = `Добавить в корзину — ${formatPrice(product.price * quantity)}`;
  }
  addBtn.addEventListener("click", () => onAddToCart(quantity));

  const body = h("div", { class: "pd-body" }, [
    h("div", { class: "pd-title" }, [product.name]),
    h("div", { class: "pd-price" }, [formatPrice(product.price)]),
    h("div", { class: "pd-desc" }, [product.description ?? ""]),
    h("div", { class: "qty" }, [minusBtn, qtyLabel, plusBtn]),
  ]);

  const scroller = h("div", { class: "scroller" }, [body]);
  const sticky = h("div", { class: "sticky-cta" }, [addBtn]);

  return h("div", { class: "screen" }, [hero, scroller, sticky]);
}
```

Modifier rendering (radio groups, price deltas) is intentionally deferred: `get-menu`'s current response (Backend Foundation) does not include modifier groups per product — that's a pre-existing gap noted in the Backend Foundation final review's Minor findings ("no modifiers in the get-menu payload"), not something this task can close without extending `get-menu` further. This screen renders quantity-only for now; adding modifiers is a follow-up once `get-menu` exposes them.

- [ ] **Step 2: Wire into `main.ts`**

Replace the `onSelectProduct`/`onContinue` placeholder comments from Task 11 with real navigation:

```ts
import { renderProductScreen } from "./screens/product.ts";

// inside showMenu(), replace the two placeholder callbacks:
function showMenu(data: GetMenuResponse) {
  hideBackButton();
  const screen = renderMenuScreen(
    data,
    (productId) => showProduct(data, productId),
    () => {
      // Task 13 wires cart navigation here.
    },
    cart
  );
  app.replaceChildren(screen);
}

function showProduct(menu: GetMenuResponse, productId: string) {
  const product = menu.products.find((p) => p.id === productId);
  if (!product) return;
  showBackButton();
  onBackButtonClick(() => showMenu(menu));
  const screen = renderProductScreen(
    product,
    (quantity) => {
      cart.add({
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity,
        modifierIds: [],
        modifierLabel: "",
      });
      cart.save();
      showMenu(menu);
    },
    () => showMenu(menu)
  );
  app.replaceChildren(screen);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/guest-miniapp/src/screens/product.ts apps/guest-miniapp/src/main.ts
git commit -m "feat: product detail screen with quantity selector

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Cart screen

**Files:**
- Create: `apps/guest-miniapp/src/screens/cart.ts`
- Modify: `apps/guest-miniapp/src/main.ts`

**Interfaces:**
- Consumes: `h`/`formatPrice`/`svgIcon` (Task 6), `CartStore`/`CartLine` (Task 9).
- Produces: `renderCartScreen(cart: CartStore, onChange: () => void, onContinue: () => void, onBack: () => void): HTMLElement`.

- [ ] **Step 1: Implement `screens/cart.ts`**

```ts
import { h, formatPrice, svgIcon } from "../dom.ts";
import type { CartStore } from "../state.ts";

export function renderCartScreen(
  cart: CartStore,
  onChange: () => void,
  onContinue: () => void,
  onBack: () => void
): HTMLElement {
  const rows = cart.getLines().map((line) => {
    const stepperMinus = h("span", { class: "cart-stepper__btn" }, [svgIcon("minus")]);
    const stepperPlus = h("span", { class: "cart-stepper__btn" }, [svgIcon("plus")]);
    const stepperN = h("span", { class: "cart-stepper__n" }, [String(line.quantity)]);
    stepperMinus.addEventListener("click", () => {
      cart.setQuantity(line.productId, line.modifierIds, line.quantity - 1);
      cart.save();
      onChange();
    });
    stepperPlus.addEventListener("click", () => {
      cart.setQuantity(line.productId, line.modifierIds, line.quantity + 1);
      cart.save();
      onChange();
    });

    const removeBtn = h("span", { class: "cart-row__remove" }, [svgIcon("close")]);
    removeBtn.addEventListener("click", () => {
      cart.remove(line.productId, line.modifierIds);
      cart.save();
      onChange();
    });

    return h("div", { class: "cart-row" }, [
      h("div", { class: "cart-row__main" }, [
        h("div", { class: "cart-row__name" }, [line.name]),
        ...(line.modifierLabel ? [h("div", { class: "cart-row__mods" }, [line.modifierLabel])] : []),
        h("div", { class: "cart-row__bottom" }, [
          h("div", { class: "cart-stepper" }, [stepperMinus, stepperN, stepperPlus]),
          h("span", { class: "cart-row__price" }, [formatPrice(line.unitPrice * line.quantity)]),
        ]),
      ]),
      removeBtn,
    ]);
  });

  const header = h("div", { class: "app-header" }, [h("div", { class: "app-header__name" }, ["Корзина"])]);
  const scroller = h("div", { class: "scroller" }, rows.length ? rows : [h("div", {}, ["Корзина пуста"])]);

  const continueBtn = h("div", { class: "btn" }, ["Продолжить"]);
  continueBtn.addEventListener("click", onContinue);
  const sticky = h("div", { class: "sticky-cta" }, [
    h("div", { class: "sticky-cta__info" }, ["Итого", h("br", {}, []), h("span", { class: "sticky-cta__price" }, [formatPrice(cart.getTotal())])]),
    continueBtn,
  ]);

  return h("div", { class: "screen" }, [header, scroller, sticky]);
}
```

- [ ] **Step 2: Wire into `main.ts`**

Replace the remaining placeholder comment in `showMenu()` and add a cart screen function:

```ts
import { renderCartScreen } from "./screens/cart.ts";

function showMenu(data: GetMenuResponse) {
  hideBackButton();
  const screen = renderMenuScreen(data, (productId) => showProduct(data, productId), () => showCart(data), cart);
  app.replaceChildren(screen);
}

function showCart(menu: GetMenuResponse) {
  showBackButton();
  onBackButtonClick(() => showMenu(menu));
  const rerender = () => showCart(menu);
  const screen = renderCartScreen(
    cart,
    rerender,
    () => {
      // Task 14 wires checkout navigation here.
    },
    () => showMenu(menu)
  );
  app.replaceChildren(screen);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/guest-miniapp/src/screens/cart.ts apps/guest-miniapp/src/main.ts
git commit -m "feat: cart screen with working quantity stepper and remove

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: Checkout screen

**Files:**
- Create: `apps/guest-miniapp/src/screens/checkout.ts`
- Modify: `apps/guest-miniapp/src/main.ts`

**Interfaces:**
- Consumes: `h`/`formatPrice`/`svgIcon` (Task 6), `CartStore` (Task 9), `createOrder` (Task 8), `getErrorMessage` (Task 10).
- Produces: `renderCheckoutScreen(cart: CartStore, locationId: string, onOrderPlaced: (orderId: string) => void, onError: (message: string) => void, onBack: () => void): HTMLElement`.

- [ ] **Step 1: Implement `screens/checkout.ts`**

```ts
import { h, formatPrice, svgIcon } from "../dom.ts";
import type { CartStore } from "../state.ts";
import { createOrder } from "../api.ts";
import { getErrorMessage } from "../errors.ts";

export function renderCheckoutScreen(
  cart: CartStore,
  locationId: string,
  onOrderPlaced: (orderId: string) => void,
  onError: (message: string) => void,
  onBack: () => void
): HTMLElement {
  let orderType: "dine_in" | "takeaway" = "dine_in";
  let requestedTimeMode: "asap" | "scheduled" = "asap";
  let comment = "";

  const dineInOpt = h("div", { class: "co-opt is-on" }, [h("div", { class: "co-opt__label" }, ["Здесь"]), h("div", { class: "co-opt__sub" }, ["Я поем здесь"])]);
  const takeawayOpt = h("div", { class: "co-opt" }, [h("div", { class: "co-opt__label" }, ["С собой"]), h("div", { class: "co-opt__sub" }, ["Возьму с собой"])]);
  dineInOpt.addEventListener("click", () => {
    orderType = "dine_in";
    dineInOpt.classList.add("is-on");
    takeawayOpt.classList.remove("is-on");
  });
  takeawayOpt.addEventListener("click", () => {
    orderType = "takeaway";
    takeawayOpt.classList.add("is-on");
    dineInOpt.classList.remove("is-on");
  });

  const asapChip = h("div", { class: "chip is-active" }, ["Как можно скорее"]);
  const scheduledChip = h("div", { class: "chip" }, ["Выбрать время"]);
  asapChip.addEventListener("click", () => {
    requestedTimeMode = "asap";
    asapChip.classList.add("is-active");
    scheduledChip.classList.remove("is-active");
  });
  scheduledChip.addEventListener("click", () => {
    requestedTimeMode = "scheduled";
    scheduledChip.classList.add("is-active");
    asapChip.classList.remove("is-active");
  });

  const commentField = h("textarea", { class: "co-field", placeholder: "Что-нибудь важное для нас? Например: без сахара" }, []) as HTMLTextAreaElement;
  commentField.addEventListener("input", () => {
    comment = commentField.value;
  });

  const placeBtn = h("div", { class: "btn btn--block" }, ["Оформить заказ"]);
  placeBtn.addEventListener("click", async () => {
    placeBtn.textContent = "Оформляем...";
    const result = await createOrder({
      locationId,
      orderType,
      requestedTimeMode,
      comment: comment || null,
      idempotencyKey: crypto.randomUUID(),
      items: cart.getLines().map((l) => ({ product_id: l.productId, quantity: l.quantity, modifier_ids: l.modifierIds })),
    });
    if (!result.ok) {
      placeBtn.textContent = "Оформить заказ";
      onError(getErrorMessage(result.error, result.reason));
      return;
    }
    cart.clear();
    cart.save();
    onOrderPlaced(result.data.order.id);
  });

  const body = h("div", { class: "scroller" }, [
    h("div", { class: "co-toggle" }, [dineInOpt, takeawayOpt]),
    h("div", { class: "mod-group__title" }, ["Время"]),
    h("div", { class: "co-time" }, [asapChip, scheduledChip]),
    h("div", { class: "mod-group__title" }, ["Комментарий"]),
    commentField,
    h("div", { class: "ticket" }, [
      ...cart.getLines().map((l) =>
        h("div", { class: "t-line" }, [h("span", {}, [`${l.quantity}× ${l.name}`]), h("span", { class: "leader" }, []), h("span", { class: "price" }, [formatPrice(l.unitPrice * l.quantity)])])
      ),
      h("div", { class: "t-total" }, [h("span", {}, ["ИТОГО"]), h("span", {}, [formatPrice(cart.getTotal())])]),
      h("span", { class: "pay-pill" }, [svgIcon("card"), "Оплата в кафе"]),
    ]),
  ]);

  const header = h("div", { class: "app-header" }, [h("div", { class: "app-header__name" }, ["Оформление"])]);
  const sticky = h("div", { class: "sticky-cta" }, [placeBtn]);
  return h("div", { class: "screen" }, [header, body, sticky]);
}
```

- [ ] **Step 2: Wire into `main.ts`**

```ts
import { renderCheckoutScreen } from "./screens/checkout.ts";

function showCart(menu: GetMenuResponse) {
  showBackButton();
  onBackButtonClick(() => showMenu(menu));
  const rerender = () => showCart(menu);
  const screen = renderCartScreen(cart, rerender, () => showCheckout(menu), () => showMenu(menu));
  app.replaceChildren(screen);
}

function showCheckout(menu: GetMenuResponse) {
  showBackButton();
  onBackButtonClick(() => showCart(menu));
  const screen = renderCheckoutScreen(
    cart,
    menu.location.id,
    (orderId) => showTracking(orderId),
    (message) => renderError(message),
    () => showCart(menu)
  );
  app.replaceChildren(screen);
}

function showTracking(orderId: string) {
  // Task 15 implements this.
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/guest-miniapp/src/screens/checkout.ts apps/guest-miniapp/src/main.ts
git commit -m "feat: checkout screen — order type, time, comment, place order

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: Confirmation + tracking screen (polling)

**Files:**
- Create: `apps/guest-miniapp/src/screens/tracking.ts`
- Modify: `apps/guest-miniapp/src/main.ts`

**Interfaces:**
- Consumes: `getOrder`, `cancelOrder` (Task 8), `h`/`formatPrice`/`svgIcon` (Task 6), `getErrorMessage` (Task 10).
- Produces: `renderTrackingScreen(orderId: string, onBackToMenu: () => void): { element: HTMLElement; stopPolling: () => void }`.

**Design note:** confirmation and tracking share one screen (per the spec — they're the same "watch this order's status" view; the design system's separate 05/06 mockups are the same information at `t=0` vs. later, not two different features).

- [ ] **Step 1: Implement `screens/tracking.ts`**

```ts
import { h, formatPrice, svgIcon } from "../dom.ts";
import { getOrder, cancelOrder, type OrderDetail, type OrderItemView } from "../api.ts";
import { getErrorMessage } from "../errors.ts";

const TERMINAL_STATUSES = new Set(["handed_out", "cancelled_by_guest", "cancelled_by_establishment", "expired"]);
const CANCELLABLE_STATUSES = new Set(["new", "waiting_confirmation", "accepted"]);

const STEPS: { status: string; label: string }[] = [
  { status: "accepted", label: "Принят" },
  { status: "preparing", label: "Готовится" },
  { status: "ready", label: "Готов" },
  { status: "handed_out", label: "Выдан" },
];

function stepState(stepStatus: string, currentStatus: string): "done" | "current" | "pending" {
  const order = STEPS.map((s) => s.status);
  const stepIdx = order.indexOf(stepStatus);
  const currentIdx = order.indexOf(currentStatus);
  if (currentIdx < 0) return "pending";
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "current";
  return "pending";
}

export function renderTrackingScreen(orderId: string, onBackToMenu: () => void): { element: HTMLElement; stopPolling: () => void } {
  const header = h("div", { class: "app-header" }, [h("div", { class: "app-header__name" }, [`Заказ`])]);
  const body = h("div", { class: "scroller" }, [h("div", {}, ["Загрузка…"])]);
  const element = h("div", { class: "screen" }, [header, body]);

  let stopped = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  function renderOrder(order: OrderDetail, items: OrderItemView[]) {
    header.replaceChildren(h("div", { class: "app-header__name" }, [`Заказ №${order.order_number}`]));

    const trackList = h(
      "div",
      { class: "track-list" },
      STEPS.map((step) => {
        const state = stepState(step.status, order.status);
        const stateClass = state === "pending" ? "" : ` is-${state}`;
        const dot = h("div", { class: "track-dot" }, state === "done" ? [svgIcon("check")] : []);
        return h("div", { class: `track-item${stateClass}` }, [dot, h("div", {}, [h("div", { class: "track-label" }, [step.label])])]);
      })
    );

    const ticket = h("div", { class: "ticket" }, [
      ...items.map((i) =>
        h("div", { class: "t-line" }, [h("span", {}, [`${i.quantity}× ${i.product_name_snapshot}`]), h("span", { class: "leader" }, []), h("span", { class: "price" }, [formatPrice(i.line_total)])])
      ),
      h("div", { class: "t-total" }, [h("span", {}, ["ИТОГО"]), h("span", {}, [formatPrice(order.total)])]),
      h("span", { class: "pay-pill" }, [svgIcon("card"), "Оплата в кафе"]),
    ]);

    const children: (Node | string)[] = [trackList, ticket];

    if (["cancelled_by_guest", "cancelled_by_establishment"].includes(order.status)) {
      children.push(h("div", { class: "cancel-note" }, ["Заказ отменён"]));
    } else if (CANCELLABLE_STATUSES.has(order.status)) {
      const cancelBtn = h("div", { class: "btn btn--secondary btn--block" }, ["Отменить заказ"]);
      cancelBtn.addEventListener("click", async () => {
        if (!confirm("Точно отменить заказ?")) return;
        const result = await cancelOrder(order.id);
        if (result.ok) load();
      });
      children.push(cancelBtn);
    } else {
      children.push(h("div", { class: "cancel-note" }, ["Отмена недоступна — заказ уже готовится"]));
    }

    const backToMenuBtn = h("div", { class: "btn btn--secondary btn--block" }, ["К меню"]);
    backToMenuBtn.addEventListener("click", onBackToMenu);
    children.push(backToMenuBtn);

    body.replaceChildren(...children.map((c) => (typeof c === "string" ? h("div", {}, [c]) : c)));

    if (TERMINAL_STATUSES.has(order.status)) stopPolling();
  }

  async function load() {
    const result = await getOrder(orderId);
    if (stopped) return;
    if (!result.ok) {
      body.replaceChildren(h("div", {}, [getErrorMessage(result.error, result.reason)]));
      return;
    }
    renderOrder(result.data.order, result.data.items);
  }

  function stopPolling() {
    stopped = true;
    if (intervalId) clearInterval(intervalId);
  }

  load();
  intervalId = setInterval(load, 6000);

  return { element, stopPolling };
}
```

- [ ] **Step 2: Wire into `main.ts`**

This replaces Task 14's placeholder `showTracking(orderId: string) { // Task 15 implements this. }` stub entirely — its signature also changes (it now takes `menu` too, so "back to menu" has somewhere to navigate to) and Task 14's `showCheckout`'s `onOrderPlaced` callback must be updated to match:

```ts
import { renderTrackingScreen } from "./screens/tracking.ts";

let currentStopPolling: (() => void) | null = null;

function showTracking(orderId: string, menu: GetMenuResponse) {
  hideBackButton();
  if (currentStopPolling) currentStopPolling();
  const { element, stopPolling } = renderTrackingScreen(orderId, () => showMenu(menu));
  currentStopPolling = stopPolling;
  app.replaceChildren(element);
}
```

Also update `showCheckout` (written in Task 14) so its `onOrderPlaced` callback passes `menu` through to the new two-argument `showTracking`:

```ts
function showCheckout(menu: GetMenuResponse) {
  showBackButton();
  onBackButtonClick(() => showCart(menu));
  const screen = renderCheckoutScreen(
    cart,
    menu.location.id,
    (orderId) => showTracking(orderId, menu),
    (message) => renderError(message),
    () => showCart(menu)
  );
  app.replaceChildren(screen);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/guest-miniapp/src/screens/tracking.ts apps/guest-miniapp/src/main.ts
git commit -m "feat: order confirmation/tracking screen with polling and cancellation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 16: Final wiring, deploy config, manual E2E checklist

**Files:**
- Modify: `apps/guest-miniapp/src/main.ts`
- Create: `apps/guest-miniapp/README.md`

**Interfaces:**
- Consumes: everything from Tasks 5-15.
- Produces: a deployable `dist/` and a documented manual test procedure — the design spec explicitly states no automated UI test replaces this.

- [ ] **Step 1: Remove the now-unused placeholder logic**

Confirm `main.ts` has no remaining "Task N wires this" comments — every screen transition (menu → product → cart → checkout → tracking, plus every `onBack`) should be a real function call after Tasks 11-15. Re-read the file and fix anything still stubbed.

- [ ] **Step 2: Run the full test suite**

```bash
cd apps/guest-miniapp
npx vitest run
```

Expected: all tests across `dom.test.ts`, `telegram.test.ts`, `api.test.ts`, `state.test.ts`, `errors.test.ts` pass.

- [ ] **Step 3: Verify the production build**

```bash
npm run build
```

Expected: succeeds, `dist/` contains `index.html` and hashed asset files including the 6 font files copied from `public/fonts/`.

- [ ] **Step 4: Write `README.md`**

```markdown
# FASDELY Guest Mini App

Telegram Mini App for guest ordering. Part of FASDELY sub-project 2.
Design: `docs/superpowers/specs/2026-08-31-guest-miniapp-design.md`.

## Development

npm install
npm run dev    # local dev server (Telegram SDK calls will throw outside Telegram — expected)
npm test       # vitest
npm run build  # production build to dist/

## Deployment

Deploy `dist/` to Cloudflare Pages (connect this repo, build command `npm run build` with base
directory `apps/guest-miniapp`, output directory `dist`).

## Manual End-to-End Checklist (required before this sub-project is done)

No automated UI test replaces real Telegram testing — the design spec is explicit about this.
Before considering sub-project 2 complete, verify inside a real Telegram client:

- [ ] QR/direct link opens the Mini App to the correct location's menu (not a different café's)
- [ ] Product detail → add to cart → cart shows the item with working +/- and remove
- [ ] Checkout: dine-in/takeaway toggle, ASAP works, comment is preserved into the order
- [ ] Order placement succeeds, confirmation screen shows the real order number and total
- [ ] Tracking screen polls and reflects a status change made via `update-order-status` (test by
      changing the order's status directly, e.g. through Supabase, while the tracking screen is open)
- [ ] Cancel button appears only while cancellable, disappears once preparing
- [ ] Telegram `BackButton` correctly steps back through every screen, never skips or dead-ends
- [ ] Bot `/меню` (as a seeded staff/owner account) lists the location's products with working
      stop/unstop and price-edit buttons; verify the resulting `audit_log` row has the real actor
- [ ] Every error condition in the design spec's Error Handling table produces its documented message,
      not a blank screen or raw error code

## Manual Secrets/Setup Steps (carried over from Backend Foundation, still pending)

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` must be set to real
  values in Supabase Edge Function secrets (currently placeholders).
- Webhook must be registered with Telegram's `setWebhook` API.
- The Mini App's launch URL must be configured in @BotFather to point at the deployed
  Cloudflare Pages URL.
- A FASDELY operator must set `profiles.telegram_user_id` for each staff/owner account that
  should have self-serve access.
```

- [ ] **Step 5: Commit**

```bash
git add apps/guest-miniapp/src/main.ts apps/guest-miniapp/README.md
git commit -m "docs: guest Mini App README, manual E2E checklist, final wiring cleanup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
```
