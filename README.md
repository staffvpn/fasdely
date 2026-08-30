# FASDELY — Backend Foundation

Multi-tenant Supabase backend for FASDELY (Telegram café ordering platform).
Design: `docs/superpowers/specs/2026-08-30-backend-foundation-design.md`.

- Pure Supabase: Postgres + RLS + PostgREST + Edge Functions + pg_cron.
- Migrations in `supabase/migrations/`, applied via the Supabase MCP
  `apply_migration` tool against project `rlxbhbdcecrnykwxnqtx` (no local
  Docker/Supabase CLI stack is used in this environment).
- Edge Functions in `supabase/functions/`; each has a dependency-free
  `logic.ts` unit-tested with Vitest, and a thin `index.ts` deployed via the
  `deploy_edge_function` MCP tool.

Run tests: `npm install && npm test`

## Status

Backend Foundation (sub-project 1 of 5) complete: multi-tenant schema, RLS
tenant isolation, audit log, menu quality view, pg_cron jobs, and 5 Edge
Functions (get-menu, create-order, update-order-status, cancel-order,
telegram-webhook) are deployed to project `rlxbhbdcecrnykwxnqtx` and ACTIVE.
53/53 unit tests passing. 12 migrations applied (8 from the original plan +
3 written during the Task 16 final security/performance pass + 1 from the
final-review hardening pass below).

**Security pass findings fixed (Task 16):** `guests` and `platform_settings`
were missing RLS entirely (ERROR-level advisor findings) — both now enabled
with operator-only read policies. `set_updated_at()` was missing a locked
`search_path`. Five internal SECURITY DEFINER functions
(`next_order_number`, `expire_stale_orders`, `refresh_seasonal_collections`,
`log_audit_event`, `handle_new_user`) were directly callable by
anon/authenticated via PostgREST RPC — revoked (verified: calling
`next_order_number()` directly as `authenticated` now fails with `42501
permission denied`, while the service-role/pg_cron path still works).
**Deliberately left as accepted risk:** `auth_role()`, `auth_business_id()`,
`auth_location_id()` remain callable via RPC — revoking them would break
every RLS policy in the schema (confirmed via grep that all three are
referenced inside policy `USING`/`WITH CHECK` clauses across 3 migration
files); the direct-call exposure only reveals a caller's own role/business/
location, which they already know.

**Performance pass findings fixed (Task 16):** `profiles_self_read`'s
`auth.uid()` call was being re-evaluated per row instead of once per query
— wrapped in a scalar subselect. Added a missing index on
`product_location_overrides.location_id`, which backs a real RLS policy
filter exercised by `get-menu` and `create-order` on every request. Left
unfixed (YAGNI, per the plan): ~130 "multiple permissive policies" findings
that are the intended by-design multi-role policy pattern used since Task
5; 6 other unindexed-FK findings with no query path in current code; 2
"unused index" findings that are false positives from a fresh database
with no real production traffic yet.

Manual steps still required before guest ordering works end-to-end (see
Tasks 12 and 15 in `docs/superpowers/plans/2026-08-30-backend-foundation.md`):
set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and
`TELEGRAM_WEBHOOK_SECRET` as Edge Function secrets once a real Telegram bot
exists, and register the webhook with Telegram's `setWebhook` API.

**Final review hardening pass:** a whole-branch review of all 16 tasks found
9 issues, all fixed in migration `0012_handoff_fixes.sql` plus `create-order`
and `update-order-status` code changes, and verified live against project
`rlxbhbdcecrnykwxnqtx`. Most important: `handle_new_user()` read
role/business_id/location_id from `raw_user_meta_data` (attacker-controlled
on public signup), letting any anonymous signup self-provision as
`fasdely_admin` — moved to `raw_app_meta_data` (service-role only); verified
live that the escalation path is closed. Also fixed: `profiles.status =
'disabled'` was never enforced (now built into
`auth_role()`/`auth_business_id()`/`auth_location_id()` and into
`update-order-status`'s profile lookup); `create-order`'s modifier lookup had
no business scoping and silently zeroed unknown modifier ids instead of
rejecting them (cross-tenant injection risk) — now scoped through
`modifier_groups`/`product_modifier_groups` and rejected with a new
`modifier_not_found` reason, plus non-negative floors added on
`orders`/`order_items` money columns as defense in depth; the idempotency
key was scoped only to `(location_id, idempotency_key)`, not per-guest;
`product_location_overrides` had no `audit_log` coverage; staff had
`for all` RLS on `orders`/`order_items`/`order_events` even though all
writes already go through service-role Edge Functions — narrowed to
read-only; `expire_stale_orders()` always reported a false `from_status:
'new'`; `update-order-status` used `event_type: 'status_change'` even for
establishment cancellations instead of matching `cancel-order`'s
`'cancellation'` convention; Realtime was never enabled on
`orders`/`order_events`; and `create-order`'s 3 writes (order, order_items,
order_events) were unchecked separate inserts — added a compensating-delete
if the `order_items` insert fails.

**Deferred to future sub-projects (not fixed in this pass):** seasonal
collections are not yet applied in `get-menu` — the schema and
`refresh_seasonal_collections()` cron job exist, but the guest-facing menu
query doesn't filter/tag products by active collection. Order creation in
`create-order` uses a compensating-delete pattern (delete the order if the
`order_items` insert fails) rather than a single atomic transaction — a
future improvement would be a `security definer` SQL function wrapping all
3 inserts (`orders`, `order_items`, `order_events`) so they commit or roll
back together.

Next: sub-project 2 (Telegram Bot + Guest Mini App).
