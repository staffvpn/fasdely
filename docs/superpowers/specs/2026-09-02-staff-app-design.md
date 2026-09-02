# FASDELY — Staff App (Order Processing) Design

Status: Approved
Date: 2026-09-02
Sub-project: 3 of 5 (Staff App) — see [Product Decomposition](../specs/2026-08-30-backend-foundation-design.md#product-decomposition)

## Goals

- Give café staff a fast, low-friction way to see incoming orders, move them
  through their lifecycle (accepted → preparing → ready → handed out), and
  cancel one when it genuinely can't be fulfilled — with an immediate
  audible/haptic alert when a new order arrives, so staff never have to
  babysit the screen.
- Fold the stop-list/price self-serve flow already built into the bot
  (sub-project 2's `/меню` command) into the same app as a second tab, so
  staff have one place to work instead of switching between an app and a
  bot chat.
- Reuse Backend Foundation's existing RLS and Realtime infrastructure
  rather than reinventing bespoke Telegram-authenticated Edge Function
  reads for every board action — staff, unlike guests, already have real
  Supabase accounts (`profiles.id` → `auth.users`), and this sub-project's
  central architectural move is bridging Telegram's identity into that
  existing session model instead of working around its absence.

## Non-Goals (explicitly out of scope for this sub-project)

- A distinct UI action for the `problem` order status — the state machine
  (`orderStateMachine.ts`) already supports it, but this sub-project's
  scope is accept → prepare → ready → hand-out, plus staff-initiated
  cancellation. Surfacing `problem` is deferred until a real workflow need
  is identified.
- `business_owner` login. Checked against the actual RLS in
  `0005_rls_orders.sql` while writing this design, not assumed: an owner's
  read policy (`orders_owner_read`) is scoped to their whole *business*
  (every location, via a `locations.business_id` join), not one location
  like staff's `orders_staff_own_location` — and `update-order-status`'s
  own authorization check only allows `staff`/`fasdely_operator`/
  `fasdely_admin` to call it at all, `business_owner` is absent from that
  list entirely. An owner who logged into this app could see a board
  mixing every location's orders together and could not act on a single
  one of them — worse than not offering it. An owner-facing, properly
  multi-location board is FASDELY Admin Dashboard territory (sub-project 4),
  not a bolt-on to this single-location action board. This sub-project's
  login is `staff` only.
- Any change to the two self-serve RPCs (`staff_set_stop`/`staff_set_price`)
  themselves — they already exist, are already reviewed and secured
  (sub-project 2), and this sub-project only adds a second UI surface that
  calls them, unchanged.
- Push notifications when the app is fully closed (not just backgrounded).
  Telegram Mini Apps have no persistent background process; an alert only
  fires while the Mini App is open. A closed-app notification would need a
  separate bot-message-based alert path, which is not requested here and
  would need its own design (rate limiting, opt-out, etc.) if it ever is.

## Architecture

**Client**: a second static Vite + TypeScript Telegram Mini App, structurally
mirroring `apps/guest-miniapp/` (same build tooling, same `h()`/hyperscript
DOM pattern, same font/token setup already approved in the design system) —
call it `apps/staff-app/`. Deployed to its own Cloudflare Pages project,
launched via a second bot command/menu button distinct from the guest deep
link.

**Auth bridge** (the core new mechanism this sub-project introduces): a new
Edge Function, `staff-authenticate-telegram`, that:
1. Verifies the Mini App's `initData` via the already-shared
   `verifyTelegramInitData` (`_shared/telegramAuth.ts`) — same verification
   used everywhere else in this project.
2. Looks up `profiles` by the verified Telegram user id, requiring an
   active `staff` role specifically — not `business_owner`,
   `fasdely_operator`, or `fasdely_admin` (see Non-Goals for why owner
   login doesn't fit this app, and why operator/admin's lack of a
   `location_id` makes their inclusion pointless here regardless).
3. If the profile's `location_id` is null, rejects with a clear error
   rather than minting a session, instead of silently succeeding into an
   empty board: RLS's `location_id = auth_location_id()` scoping reads the
   stored column directly, so no amount of JWT cleverness produces a
   working board without one on file. `location_id` is a plain nullable
   FK with no schema-level constraint tying it to role — Backend
   Foundation's operational expectation is that every `staff` profile gets
   one set at onboarding, but nothing enforces it, so this is a genuine
   (if hopefully rare) data-entry gap to guard against, not a theoretical
   one. This mirrors the same resolution gap sub-project 2's bot
   self-serve flow already surfaces honestly rather than papering over.
4. Otherwise, mints a Supabase-compatible JWT signed with the project's
   JWT secret, `sub` set to the profile's `id` (which is a real
   `auth.users.id`, so `auth.uid()` resolves correctly everywhere
   downstream), `role` set to `authenticated`, short-lived (1 hour).
5. Returns that JWT to the client, which sets it as its Supabase session
   (`supabase.auth.setSession` or equivalent) for the rest of the app's
   lifetime — re-authenticating from scratch (re-verify `initData`, mint a
   fresh JWT) each time the Mini App is opened, mirroring the guest app's
   stateless-per-open model rather than trying to persist/refresh a
   long-lived session.

Once bridged, the staff app is — from Postgres's point of view — an
ordinary logged-in Supabase client. This is deliberate and is what makes
the rest of the design small:
- **Reading the board needs no new backend code.** `orders_staff_own_location`,
  `order_items_staff_own_location`, and `order_events_staff_own_location`
  RLS policies (already in `0005_rls_orders.sql`, scoped via
  `auth_role() = 'staff' and location_id = auth_location_id()`) apply
  automatically to any query this session makes.
- **Realtime works natively.** The client subscribes to Postgres changes on
  `orders` (and `order_items` for line-item detail) via `supabase-js`'s
  Realtime client; RLS gates which rows the subscription can see, so a
  `staff` session only ever receives events for its own location.
- **`update-order-status` needs no auth changes.** It already validates a
  `Authorization: Bearer <jwt>` header via `auth.getUser()` and looks up
  the caller's profile — the bridged JWT satisfies that path unmodified.
  It does need one small, additive extension (see Order Actions below).

**Alternatives considered and rejected**: (a) a bespoke Telegram-initData-
authenticated polling Edge Function mirroring the guest app's `get-order` —
rejected because it duplicates RLS's tenant-scoping logic in application
code and can't deliver an immediate alert without polling every 2-3
seconds, which the product requirement (instant sound/vibration) rules
out; (b) a conventional email+password Supabase Auth login screen inside
the Mini App — rejected per explicit product direction: staff should never
need a separate credential, the same as guests never holding an account.

## Board: Columns, Status Mapping, and Actions

Four columns, matching the already-approved design-system mockup
(`docs/design/fasdely-design-system.html`'s `.board`/`.board-col` markup):

| Column | Order statuses shown | Staff action (button) | Resulting transition(s) |
|---|---|---|---|
| Новые | `new` | Принять | `new` → `accepted` → `preparing` (both hops fired as one user action — see note) |
| | | Отменить | `new` → `cancelled_by_establishment`, with a required reason |
| Готовятся | `accepted`, `preparing` | Готово | `preparing` → `ready` |
| Готовы | `ready` | Выдано | `ready` → `handed_out` (card leaves the board) |
| Отменён | `cancelled_by_guest`, `cancelled_by_establishment` | — (read-only) | — |

**Note on "Принять" firing two transitions:** `canStaffTransition`'s table
only allows `new → accepted` and separately `accepted → preparing` — there
is no direct `new → preparing` hop. Exposing "accepted" as its own
staff-visible waiting column would add a step with no operational meaning
for a single-location café board (nobody needs to see "seen but not yet
started" as a distinct state to act on). The client therefore calls
`update-order-status` twice in immediate sequence (`accepted`, then
`preparing`) when "Принять" is tapped, and only re-renders the card once
both calls resolve — to staff, it reads as one tap, one move, matching the
mockup. If the second call fails after the first succeeds (rare, but
possible under a dropped connection), the card shows the real current
status (`accepted`) on the next Realtime event or manual refresh — never a
silently wrong status, since the client always displays server-confirmed
state, not optimistic state that was never confirmed.

**Cancellation** reuses `update-order-status` with `to_status:
"cancelled_by_establishment"`. That function currently accepts only
`{order_id, to_status}` — extended (additively, non-breaking) to also
accept an optional `reason: string`, written into the `order_events` row
it already inserts, mirroring `cancel-order`'s existing `reason` handling
for guest-initiated cancels. The client requires a non-empty reason before
enabling the cancel confirmation, matching the design intent ("закончился
ингредиент" should end up in the record, not just "cancelled").

**Board display, not just status**: each card shows order number, time,
dine-in/takeaway badge, line items (from `order_items`), any guest
comment, and total — all fields already present in the approved mockup and
already queryable under RLS once the auth bridge is in place.

## Self-Serve Tab

A second tab in the same app, reusing `staff_set_stop`/`staff_set_price`
(sub-project 2) exactly as they are — both RPCs already take
`p_telegram_user_id` as an explicit parameter (not `auth.uid()`), so the
bridged Supabase session changes nothing about how they're called; the
client still passes the Telegram user id it already has from `initData`.
No RPC changes. The UI is a straightforward product list (name, current
price, stop/unstop toggle, tap-to-edit price) — the same data
`fetchProductListEntries` (in `telegram-webhook/index.ts`) already
assembles for the bot's `/меню` keyboard, now queried directly by the
client under RLS instead of by the bot via service role.

The bot's `/меню` command is left untouched — both entry points keep
working side by side (a staff member without the Mini App open yet, or
who prefers the chat command, isn't broken by this addition).

## New-Order Alert

On a Realtime `INSERT` event for `orders` scoped to the staff member's
location, the client:
1. Triggers `Telegram.WebApp.HapticFeedback.notificationOccurred('success')`
   (or similar) for immediate vibration — always available, no permission
   prompt needed, per the Telegram Mini App SDK.
2. Plays a short audio cue via a preloaded `<audio>` element.

**Known risk, addressed explicitly rather than left to surprise later**:
mobile WebViews (which Telegram Mini Apps run inside) commonly block audio
autoplay until the user has interacted with the page at least once. The
app's first-open flow includes a small "Включить звук" tap-to-enable step
(a single button, not a settings menu) before the board renders, so the
very first real order of a session doesn't silently fail to play sound.
Vibration is unaffected by this restriction and fires regardless.

## Error Handling

| Condition | Staff sees |
|---|---|
| `staff-authenticate-telegram` fails (invalid/expired `initData`, no matching profile, inactive account) | A blocking screen: "Не удалось подтвердить доступ. Обратитесь к FASDELY." — no board, no silent partial state |
| Realtime subscription drops (network blip) | A small persistent banner ("Переподключение…") while `supabase-js` auto-reconnects; board contents stay as last-known until reconnected, not cleared |
| `update-order-status` call fails (network or business-rule rejection) | The attempted button shows its error inline on the card ("Не удалось: <reason>") and reverts to its pre-tap state — never silently stuck on a "loading" label |
| Self-serve RPC call fails | Same `staffErrorMessage`-style Russian mapping already built for the bot (sub-project 2) — ported into this app rather than re-invented, since the RPCs raise the same four error codes regardless of caller |

## Testing Strategy

- Pure logic (status-to-column mapping, the two-hop "Принять" sequencing
  logic, cancellation-reason validation) gets Vitest unit tests, following
  the exact `logic.ts` + `logic.test.ts` split already established in this
  project's Edge Functions and in `apps/guest-miniapp/`.
- `staff-authenticate-telegram` gets the same TDD treatment as every prior
  Edge Function in this project: pure `logic.ts` (profile lookup shape,
  JWT claims construction) + thin `index.ts` adapter, unit-tested, then
  smoke-tested live post-deploy.
- Realtime behavior, actual haptic/audio firing, and the RLS-scoped
  subscription itself cannot be meaningfully unit-tested (they require a
  live Postgres connection and a real Telegram client) — verified via a
  manual checklist before this sub-project is considered done, matching
  the precedent already set in `apps/guest-miniapp/README.md`.

## Manual Steps Required

- A second bot command or menu button (e.g. `/board`) configured in
  @BotFather, launching the staff app's own Mini App URL — distinct from
  the guest ordering deep link.
- `SUPABASE_JWT_SECRET` must be available to `staff-authenticate-telegram`
  as an Edge Function secret (Supabase exposes this automatically for
  projects using the default JWT-based auth, but confirm it's accessible
  to Edge Functions in this project specifically before implementation
  assumes it).
- Cloudflare Pages project for `apps/staff-app/`, same pattern as the
  guest app's deploy.
- Existing manual steps already carried over from sub-projects 1-2 (real
  `TELEGRAM_BOT_TOKEN` etc.) are prerequisites here too, not duplicated.
