# FASDELY — Telegram Bot + Guest Mini App Design

Status: Approved
Date: 2026-08-31
Sub-project: 2 of 5 (Telegram Bot + Guest Mini App) — see [Product Decomposition](../specs/2026-08-30-backend-foundation-design.md#product-decomposition)

## Goals

- A guest scans a QR, lands directly in a full-screen Telegram Mini App showing
  the right café's menu, orders, and tracks their order — no visible bot
  chat step required for the happy path.
- Business owners/staff get a narrow, low-friction self-serve path in the
  same bot for the two operations identified in the hybrid decision
  (stop-list toggle, price edit) — everything else in menu management still
  goes through FASDELY operators, preserving the managed-menu
  differentiation.
- Zero new paid infrastructure. Reuse the Backend Foundation's 5 deployed
  Edge Functions as-is wherever possible; extend only where a real gap
  exists.

## Non-Goals

- Staff order-processing UI (order board) — sub-project 3.
- FASDELY Admin Dashboard — sub-project 4.
- Real-time order-status push for guests via Supabase Realtime — guests have
  no Supabase Auth session (by design), so this sub-project uses polling
  instead (see Architecture). Realtime is reserved for sub-project 3, where
  staff have real sessions RLS already trusts.
- Free-text natural-language parsing of owner/staff requests in the bot —
  the self-serve flow uses inline-keyboard menus instead (see Self-Serve
  section) to keep the write path deterministic and auditable.
- Table-level QR codes (`location_tables.qr_token` already exists in the
  schema) — out of scope for this pass; the product prompt's own guidance
  is "one location → one primary QR" for the MVP.

## Architecture

**Stack**, confirmed during brainstorming:

- Bot logic extends the existing `telegram-webhook` Supabase Edge Function
  — no new runtime, no new hosting. Zero-infra-budget principle from the
  original product spec.
- Guest Mini App: a static Vite + vanilla TypeScript single-page app in a
  new `apps/guest-miniapp/` directory in this same repo, deployed to
  Cloudflare Pages (free tier, matches the product spec's preferred
  infrastructure list).
- No client-side router. A Telegram Mini App lives inside one chat-session
  view; screen transitions are driven by an in-memory view-state store plus
  Telegram's own `BackButton` API for physical back navigation — not URL
  hash routing.
- Authentication for every write the guest makes is Telegram `initData`,
  verified server-side by the already-shipped `verifyTelegramInitData`
  (`supabase/functions/_shared/telegramAuth.ts`) — no new auth mechanism.

## QR → Menu Resolution (real integration gap found and closed)

The QR code encodes a direct Mini App launch link
(`https://t.me/<bot>/app?startapp=<location_qr_token>`), so the guest goes
straight to the menu with no bot chat step. This means the **Mini App
itself**, not the bot, is what receives `qr_token` on launch (via
`Telegram.WebApp.initDataUnsafe.start_param`).

`get-menu` (Task 11, Backend Foundation) currently only accepts a raw
`location_id` UUID as a query parameter — it has no way to resolve a public
`qr_token` into a location. This sub-project extends `get-menu` (additive,
backward-compatible) to accept **either** `location_id` or `qr_token`;
when given `qr_token`, it resolves the location internally and includes
`location_id` in the response payload, so the Mini App can reuse it for
subsequent `create-order`/`cancel-order`/`get-order` calls without a second
round-trip. `telegram-webhook`'s existing `/start <qr_token>` handling
(used only as a fallback path if a guest lands via the bot chat instead of
the direct app link) is unaffected.

## Guest Ordering Flow

Screens match the mockups already validated in
`docs/design/fasdely-design-system.html`: menu → product detail → cart →
checkout (order type / time / comment) → confirmation → tracking.

- **State**: a single typed in-memory store (current screen, selected
  product, cart contents) plus `localStorage` persistence for the cart, so
  a guest who backgrounds the Mini App mid-order doesn't lose their cart.
- **Menu**: `get-menu` response drives categories/products; stop-list and
  location-override filtering already happen server-side (Backend
  Foundation), the client only renders what it's given.
- **Cart**: quantity stepper and remove control per line (the interactive
  affordances the design pass added — a read-only ticket replica is
  insufficient for an editable cart). Client-side subtotal shown for
  responsiveness only; `create-order` recomputes authoritatively, per the
  Backend Foundation's server-side-pricing guarantee.
- **Checkout**: order type (dine-in/takeaway), ASAP/scheduled time
  validated client-side for immediate feedback, then re-validated
  server-side by `create-order`'s existing `validateRequestedTime` call —
  the client never trusts its own validation as final.
- **Order placement**: calls `create-order` with the cart, `location_id`
  (from the QR resolution step), a client-generated idempotency key (UUID),
  and `initData`. Handles all of `create-order`'s existing error responses
  (`product_unavailable`, `invalid_time`, etc.) with the human-readable
  error states below — never a raw error code shown to the guest.

## Order Tracking (polling, not Realtime — explicit trade-off)

Guests have no Supabase Auth session by design (Backend Foundation
decision), and the `orders`/`order_events` RLS policies grant read access
only to `staff`/`fasdely_operator`/`fasdely_admin`/`business_owner` roles —
none of which a guest holds. Standing up guest-scoped Realtime access would
require either a new RLS carve-out keyed on unverifiable claims or a
Realtime Broadcast-channel authorization scheme — real complexity for an
MVP guest feature.

Instead: a new lightweight Edge Function `get-order` (guest-owned,
`initData`-verified, mirrors `cancel-order`'s ownership-check pattern) that
the Mini App polls every 5–8 seconds while the tracking screen is open,
stopping once the order reaches a terminal status. This is the same
class of trade-off already made once in Backend Foundation (server-side
verification over convenient-but-complex auth) — staying consistent with
it here. Sub-project 3's staff board uses real Supabase Realtime
subscriptions instead, since staff already have sessions RLS trusts.

## Self-Serve: Owner/Staff Stop-List & Price (hybrid decision, implemented here)

**Identity bridge (real gap found and closed):** `profiles` rows are
currently linked to Supabase Auth users (email+password, Task 4 of Backend
Foundation) with no connection to a Telegram identity — the bot has no way
to know "who is texting it." This sub-project adds `profiles.telegram_user_id`
(new column, unique, nullable) via a small migration. A FASDELY operator
sets this value manually when onboarding a staff member's Telegram account
— consistent with the managed-service philosophy already established
everywhere else in the product (nobody self-registers into a privileged
role).

**Interaction pattern:** inline-keyboard menus in the bot chat, not
free-text parsing. A staff/owner sends `/меню` (or a persistent menu
button); the bot looks up `profiles` by the sender's `telegram_user_id`
(service role, explicit role check — the pattern already established for
Edge Functions using the service role instead of a user session), replies
with a paginated list of their location's products as inline buttons
showing name, current stop-list state, and price. Tapping a product opens
two actions: toggle stop-list, or edit price (prompts for a numeric reply,
validated before writing). This avoids the ambiguity of matching free text
like "stop cheesecake" against a catalog, and makes every action
independently auditable.

**Audit logging:** every self-serve change writes to `stop_list` /
`products.base_price` / `product_location_overrides.price_override`
exactly like an operator-made change, so the existing `log_audit_event()`
triggers fire automatically — but the actor must be the acting staff
member, not `NULL` (which `auth.uid()` resolves to under a service-role
connection with no Supabase session).

Concrete mechanism (decided here, not deferred): two new
`security definer` SQL functions, `staff_set_stop(p_actor_id uuid, ...)`
and `staff_set_price(p_actor_id uuid, ...)`, each do three things in one
transaction: (1) verify `p_actor_id` resolves to a `profiles` row with
role `staff`/`business_owner` and the right `business_id`/`location_id`
for the target product — the same authorization check RLS would do, done
explicitly here since the call runs as service role; (2) run
`perform set_config('fasdely.actor_id', p_actor_id::text, true)` — the
final `true` scopes it to the current transaction only; (3) perform the
actual `update`/`insert`, which fires the existing audit trigger.
`log_audit_event()` (`supabase/migrations/0006_audit_log.sql`) gets a
one-line change: read
`coalesce(current_setting('fasdely.actor_id', true)::uuid, auth.uid())`
instead of `auth.uid()` directly, so operator-made changes (real
`auth.uid()`, no local override) and self-serve changes (explicit actor,
via the transaction-scoped setting) both resolve correctly through the
same trigger, with no duplicated logging logic. This was flagged as a
requirement in the original hybrid-decision note and is being honored
here, not introduced fresh.

## Error Handling

Every guest-facing failure maps to a specific, human-readable screen — no
raw error codes, no blank screens (per the product prompt's own explicit
rule and the QA doc's "error states" section):

| Condition | Guest sees |
|---|---|
| No network | "Нет интернета. Проверьте подключение и попробуйте снова." + retry |
| Location closed / outside order-acceptance hours | "Сейчас не принимаем заказы. Часы работы: …" |
| Product removed from cart by a stop-list change | "Этот товар закончился. Уберём его из заказа?" — not a silent failure |
| `create-order` rejects (any reason) | Reason-specific message, e.g. price/availability changed — never "Error 500" |
| Telegram `initData` invalid/expired | "Не удалось подтвердить, что это вы. Откройте меню заново из Telegram." |
| Order polling (`get-order`) fails | Keep last known status visible, retry silently, only surface an error after repeated failures |

Payment messaging: every screen that shows a total explicitly labels
"Оплата в кафе" — FASDELY never implies it processed payment, per the
security doc's explicit rule.

## Testing Strategy

- Vitest unit tests (matching the Backend Foundation's established
  pattern) for pure logic: cart math (display-only, not authoritative),
  `start_param`/`initData` parsing, checkout time-window client-side
  pre-validation.
- New `get-order` Edge Function gets the same TDD treatment as Backend
  Foundation's functions: pure `logic.ts` + tests, thin `index.ts` adapter.
- The self-serve bot flow (inline-keyboard state machine) is tested via
  its own pure logic module (parsing callback-query payloads, resolving
  the acting staff member, computing the next keyboard state) — same
  pattern.
- No automated UI testing for the Mini App itself — Telegram Mini App
  behavior (viewport, theming, `BackButton`, haptics) can only be verified
  by manual testing inside real Telegram before this sub-project is
  considered done, exactly as the QA doc already states for anything
  requiring a UI.

## Manual Steps Required (carried over from Backend Foundation, now actionable)

- Set the real `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
  `TELEGRAM_WEBHOOK_SECRET` secrets (currently placeholders) once a real
  bot is registered with @BotFather.
- Register the webhook URL with Telegram's `setWebhook` API.
- Configure the Mini App's launch URL in @BotFather to point at the
  deployed Cloudflare Pages URL.
- A FASDELY operator manually sets `profiles.telegram_user_id` for each
  onboarded staff/owner account (part of the onboarding SOP already
  described in `docs/operations/operations-model.md`).
