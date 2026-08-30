-- Fixes for findings from the Supabase security advisor (Task 16 final pass):
-- https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
-- https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
-- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
-- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

-- ERROR: guests and platform_settings were created (Task 4) without RLS enabled,
-- unlike every other tenant-facing table. Neither table has any FASDELY-operator-only
-- use case for anon/authenticated write access, so enable RLS fail-closed and add
-- read-only visibility for operators/admins only. Guests are never given a Supabase
-- Auth account (per design) and platform_settings is read by Edge Functions via the
-- service role, which bypasses RLS entirely — so neither policy blocks any real path
-- this backend actually uses.
alter table guests enable row level security;
create policy guests_operator_read on guests for select
  using (auth_role() in ('fasdely_operator','fasdely_admin'));

alter table platform_settings enable row level security;
create policy platform_settings_operator_read on platform_settings for select
  using (auth_role() in ('fasdely_operator','fasdely_admin'));

-- WARN: set_updated_at() (Task 2) was the one trigger function missing a locked
-- search_path (unlike every security-definer function added from Task 5 onward).
-- It doesn't need elevated privileges, so this only adds the search_path guard.
create or replace function set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- WARN: these SECURITY DEFINER functions are meant to be invoked only from triggers,
-- pg_cron, or Edge Functions using the service role — never called directly by an
-- anon/authenticated client via PostgREST RPC (e.g. POST /rest/v1/rpc/next_order_number).
-- Confirmed via grep across all migrations that none of these five are referenced
-- inside any RLS policy's USING/WITH CHECK clause, so revoking PUBLIC execute cannot
-- break tenant isolation. next_order_number(uuid) is the most concretely exploitable
-- of the five if left open: any anon/authenticated caller could otherwise invoke it
-- directly with an arbitrary location_id and mutate that location's daily order
-- counter. The other four (trigger-only functions, or the pg_cron job bodies) would
-- likely error harmlessly if called directly, but are revoked too for defense in depth.
-- service_role and postgres already have default privileges on this schema from
-- Supabase's own project bootstrap; the explicit grants below are belt-and-suspenders,
-- not strictly required, so that these functions keep working from Edge Functions
-- (service role) and pg_cron (runs as postgres) regardless of that default.
revoke execute on function next_order_number(uuid) from public;
revoke execute on function expire_stale_orders() from public;
revoke execute on function refresh_seasonal_collections() from public;
revoke execute on function log_audit_event() from public;
revoke execute on function handle_new_user() from public;

grant execute on function next_order_number(uuid) to service_role, postgres;
grant execute on function expire_stale_orders() to service_role, postgres;
grant execute on function refresh_seasonal_collections() to service_role, postgres;
grant execute on function log_audit_event() to service_role, postgres;
grant execute on function handle_new_user() to service_role, postgres;

-- Deliberately NOT touched: auth_role(), auth_business_id(), auth_location_id() are
-- also flagged as directly callable by anon/authenticated — but revoking PUBLIC
-- execute on these would break every RLS policy across the whole schema, since a
-- policy's USING/WITH CHECK clause is evaluated with the querying role's own
-- privileges and needs EXECUTE on any function it calls. Confirmed via grep that all
-- three are referenced inside RLS policies in 0004_rls_catalog.sql, 0005_orders.sql,
-- and 0006_audit_log.sql. The direct-call exposure is low severity in practice: each
-- function derives its result from auth.uid() (the CALLING user's own identity), so a
-- user calling e.g. `select auth_business_id()` only ever learns their own business_id
-- — information they already have simply by being logged in as themselves. This is an
-- accepted, understood risk, not an oversight.
