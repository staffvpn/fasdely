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
51/51 unit tests passing. 11 migrations applied (8 from the original plan +
3 written during the Task 16 final security/performance pass).

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

Next: sub-project 2 (Telegram Bot + Guest Mini App).
