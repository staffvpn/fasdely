# FASDELY — Backend Foundation Design

Status: Approved
Date: 2026-08-30
Sub-project: 1 of 5 (Backend Foundation) — see [Product Decomposition](#product-decomposition)

## Product Decomposition

FASDELY's full spec (guest ordering, staff workflow, FASDELY admin/menu-management,
multi-location, analytics, subscriptions, advertising) is too large for a single
spec/plan. It is decomposed into sub-projects, each with its own spec → plan →
implementation cycle:

1. **Backend Foundation** (this document) — multi-tenant data model, auth/roles,
   RLS, core Edge Functions for menu retrieval and order lifecycle, audit log.
2. Telegram Bot + Guest Mini App (ordering flow) — depends on (1).
3. Staff App (order processing) — depends on (1).
4. FASDELY Admin Dashboard (menu/business/location management) — depends on (1).
5. Analytics, subscriptions billing, advertising — later, needs live order data.

### Decision (2026-08-30): hybrid self-serve for stop-list and price

The product/business prompts originally specified that café owners/staff never
edit the menu directly — all changes go through FASDELY operators via Telegram
message. On reflection, this creates real friction for the two highest-frequency,
lowest-risk operations: toggling item availability (86'ing something) and
changing an existing item's price. Both are mechanical (no risk to menu
presentation quality/Menu Health Score) and often time-sensitive.

**Revised model (to be designed in sub-project 2):** `business_owner`/`staff`
get a narrow, self-serve path inside the same Telegram bot for exactly two
operations — stop-list toggle and price edit on an *existing* product. Every
other change (new products, photos, descriptions, categories, seasonal
collections, promotions) still goes through FASDELY operators via Telegram
message, preserving the managed-menu differentiation and quality control that
justify the subscription.

This does not change the Backend Foundation schema: `stop_list` and
`products.base_price`/`product_location_overrides.price_override` already
exist (Task 3, Task 2), `business_owner`/`staff` roles and their RLS read
scope already exist (Task 5). Sub-project 2 will need two narrow, audited
write paths (Edge Functions or tightly-scoped RLS write policies) for these
two operations specifically — every such change must still land in
`audit_log` with the correct actor, same as operator-made changes, so the
change history stays complete regardless of who made the edit.

This document covers sub-project 1 only.

## Goals

- A single, secure, multi-tenant backend that every future frontend (guest Mini
  App, staff app, admin dashboard) calls into.
- Enforce tenant isolation so one business can never see another's data.
- Guest ordering must be safe against stale prices, unavailable items, and race
  conditions, without requiring guests to hold an account.
- Every menu/price/stop-list change is attributable and auditable (section 24 of
  the product prompt).
- Stay on free-tier infrastructure only (product prompt section 32).

## Non-Goals (explicitly out of scope for this sub-project)

- No frontend code (bot, Mini App UI, staff UI, admin UI) — later sub-projects.
- No AI features (explicitly excluded from MVP, section 31).
- No online payment processing (guests pay at the counter, section 33).
- No automated subscription billing (manual for now, section 33).
- No advertising/promotion marketplace implementation (section 30) — schema
  leaves room, but no logic yet.

## Architecture

**Pure Supabase**: Postgres + Row Level Security + auto-generated PostgREST API
(for authenticated staff/operator/admin CRUD) + Supabase Edge Functions (Deno/TS)
for custom logic (Telegram `initData` verification, order placement with
server-side price recomputation, order status state machine, bot webhook) +
Supabase Realtime (live order updates for staff/guest) + `pg_cron` (order
expiration, seasonal collection activation/deactivation).

Rejected alternatives:
- Separate Node/Express backend: duplicates what PostgREST+RLS gives for free,
  needs hosting outside the preferred free-tier stack.
- Cloudflare Workers as the API layer: a second serverless runtime alongside
  Supabase Edge Functions with no clear benefit at this stage.

## Data Model

Hierarchy: `businesses → locations → categories/products → modifiers`,
`locations → orders → order_items/order_events`, with `stop_list`,
`seasonal_collections`, `promotions`, `audit_log`, `profiles` (staff/operator
roles), and `guests` (lightweight Telegram identity) cutting across it.

### Tenant & catalog tables

- **businesses**: id, name, logo_url, description, contacts(jsonb), status
  (active/suspended/trial/etc.), subscription_plan, subscription_status,
  created_at, updated_at.
- **locations**: id, business_id, name, address, timezone, working_hours(jsonb
  schedule per weekday), order_acceptance_hours(jsonb, may differ from working
  hours), default_prep_time_minutes, qr_token(unique, used as the Mini App
  start-parameter to resolve location without asking the guest), status,
  created_at.
- **location_tables** (optional dine-in context): id, location_id, label
  (e.g. "Table 5", "Zone A"), qr_token(unique, optional per-table QR).
- **categories**: id, business_id, name, icon/emoji, sort_order, status.
- **products**: id, business_id, category_id, name, description, base_price,
  image_url, calories, protein_g, fat_g, carbs_g, ingredients(text),
  allergens(text[]), badges(text[]: NEW/TOP/POPULAR/SPECIAL), status
  (draft/published/archived), created_by, updated_at.
- **product_location_overrides**: product_id, location_id, price_override
  (nullable), is_available, is_published — implements "shared master menu with
  location-level overrides" (product prompt section 6) without duplicating
  products per location.
- **modifier_groups**: id, business_id, name (e.g. "Milk", "Size"),
  selection_type(single/multiple), is_required, min_select, max_select.
- **modifiers**: id, modifier_group_id, name, price_delta.
- **product_modifier_groups**: product_id, modifier_group_id — reusable
  modifier groups shared across products.
- **seasonal_collections**: id, business_id, name, start_date, end_date,
  status(scheduled/active/expired/hidden), auto_activate.
- **collection_products**: collection_id, product_id, location_ids(nullable
  array — null means all locations of the business).
- **promotions**: id, business_id, name, description, discount_type,
  discount_value, target_type(product/category/collection), target_id,
  start_at, end_at, status.
- **stop_list**: id, scope_type(product/modifier/category/collection),
  scope_id, location_id(nullable = all locations of the business),
  reason, stopped_until(nullable timestamp), stopped_for_today(bool),
  created_by, created_at, lifted_at.

### Order tables

- **orders**: id, location_id, table_id(nullable), guest_telegram_user_id,
  order_type(dine_in/takeaway), requested_time_mode(asap/scheduled),
  requested_time(nullable timestamp), status (new / waiting_confirmation /
  accepted / preparing / ready / handed_out / cancelled_by_guest /
  cancelled_by_establishment / expired / problem), comment, subtotal, total,
  currency, order_number(sequential per location per day), idempotency_key,
  created_at, updated_at.
- **order_items**: id, order_id, product_id, product_name_snapshot,
  unit_price_snapshot, quantity, modifiers_snapshot(jsonb — name+price at
  order time), line_total. Snapshots protect historical orders from later
  menu edits.
- **order_events**: id, order_id, event_type(status_change/comment/
  cancellation), from_status, to_status, actor_type(guest/staff/system),
  actor_id(nullable), reason(nullable), created_at — full lifecycle audit
  trail (product prompt section 18/19).

### Platform, identity & audit tables

- **platform_settings**: singleton/key-value config — subscription plan
  prices (START/PRO/NETWORK), setup fees, cancellation windows, order
  expiration timeout — configurable data, never hard-coded (sections 28-29).
- **profiles**: id (= auth.uid()), role(staff/business_owner/
  fasdely_operator/fasdely_admin), business_id(nullable), location_id
  (nullable), full_name, status.
- **guests**: telegram_user_id(pk), first_name, username, last_seen_at,
  created_at — no password, no Supabase Auth account; populated from
  verified Telegram `initData`.
- **audit_log**: id, entity_type, entity_id, business_id, action(create/
  update/delete/publish/unpublish/stop/price_change/...), before(jsonb),
  after(jsonb), actor_id, actor_role, created_at — generic change history
  covering all menu-management mutations (section 24).

## Auth, Roles & Tenant Isolation

- **Supabase Auth** (email+password) is used only for staff, business_owner,
  fasdely_operator, fasdely_admin. Role and scope live in `profiles`.
- RLS policies:
  - `fasdely_operator` / `fasdely_admin`: full read/write across all
    businesses (they manage the digital menu on behalf of every café,
    section 3).
  - `business_owner`: read-only on their own `business_id` (owners talk to
    FASDELY via Telegram in the MVP, no menu-editing access, section 3) —
    RLS scaffolding is in place now so this can be extended later without a
    schema change.
  - `staff`: read-only on their location's menu, read/write on orders
    scoped to their `location_id` only.
- **Guests never get a Supabase Auth account.** The Telegram Mini App sends
  Telegram `initData` (HMAC-signed with the bot token) on every
  order-sensitive request. An Edge Function verifies the signature
  server-side before creating/cancelling an order. Guest requests never use
  the anon/service key directly from the client — they go through Edge
  Functions using the service role internally, with manual scoping in code
  (never trust client-supplied prices or availability).

## Core Edge Functions

- `telegram-webhook` — receives bot updates; for this sub-project, only
  enough to resolve `/start <location_qr_token>` deep links (full bot
  behavior is sub-project 2).
- `get-menu(location_id)` — published categories/products with location
  overrides, stop-list filtering, and active seasonal collections applied.
- `create-order` — recomputes price from current DB state server-side
  (never trusts client price), validates product/modifier availability and
  stop-list, validates requested time against location hours and prep time,
  writes `orders`+`order_items`+initial `order_event`, is idempotent via a
  client-supplied idempotency key (prevents duplicate orders on retry).
- `update-order-status` (staff) — enforces the status state machine, uses a
  conditional `UPDATE ... WHERE status = <expected>` to prevent two staff
  members double-processing the same order, writes `order_events`, and
  broadcasts via Realtime.
- `cancel-order` (guest) — allowed only while status is in a configurable
  cancellable set; records cancellation source and reason in `order_events`.
- `pg_cron` jobs: mark orders `expired` past a configurable timeout in
  `platform_settings`; flip `seasonal_collections.status` at
  `start_date`/`end_date`.

## Menu Quality Score

A rule-based calculation (DB view or Edge Function), never fabricated:
percentage of published products that have image, description, calorie
info, allergen info, and price set. Exposed per business/location for the
future admin dashboard (sub-project 4).

## Edge Cases Covered by This Design

- **Stale cart price**: price is always recomputed server-side at
  `create-order`, so a price change never silently applies an old price.
- **Product goes unavailable mid-cart**: availability/stop-list is
  re-checked at `create-order`, not just at menu display time.
- **Location closes during checkout**: `create-order` validates the
  requested time against current location hours.
- **Two staff members accept the same order**: conditional `UPDATE` guard
  makes the second attempt a no-op with a clear "already handled" response.
- **Duplicate order on client retry**: idempotency key on `create-order`.
- **Order not accepted in time**: `pg_cron` expiration job.
- **Guest vs. establishment vs. system cancellation**: distinguished via
  `actor_type`/source on `order_events`, never conflated (section 19).
- **Seasonal collection expiry**: `pg_cron` flips status automatically.

## Testing Strategy

- SQL migration tests: RLS policies verified with `pg_tap` or direct
  role-switch queries (business A cannot read business B's data; staff
  cannot read another location's orders).
- Edge Function tests: Deno test runner, mocking Postgres via a local
  Supabase instance (`supabase start`), covering price recomputation,
  stop-list enforcement, idempotency, and the status state machine
  (including the race-condition guard).
- Local development happens against the Supabase CLI local stack before
  migrations are applied to the remote project.

## Infrastructure

- Supabase project under the existing `nichegotakova` organization
  (Free tier). Note: the org already has 2 projects (`ncht`, inactive; and
  `digital-vault`, active) — Free tier orgs are capped at 2 active
  projects, so provisioning is handled at implementation time (pausing an
  unused project or confirming headroom before creating a third).
- New GitHub repository `fasdely` (private), initialized from this local
  working copy.
