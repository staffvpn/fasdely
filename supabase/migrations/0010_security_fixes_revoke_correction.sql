-- Correction to 0009_security_fixes.sql: Supabase grants EXECUTE on public-schema
-- functions to anon/authenticated directly (via ALTER DEFAULT PRIVILEGES at project
-- bootstrap), not through the PUBLIC pseudo-role — so "revoke ... from public" alone
-- did not actually remove anon/authenticated's ability to call these functions
-- directly via PostgREST RPC. Confirmed via information_schema.routine_privileges
-- (showed explicit EXECUTE grants to anon and authenticated, separate from any grant
-- to public) and by reproducing the direct call as 'authenticated' before this fix —
-- it succeeded when it should have been denied. Revoking from anon/authenticated
-- explicitly (in addition to public, left in 0009 for documentation/defense-in-depth)
-- actually closes the direct-call surface. Verified after applying: calling
-- next_order_number() as 'authenticated' now fails with 42501 permission denied,
-- while calling it as postgres (proxy for service_role/pg_cron) still succeeds.
revoke execute on function next_order_number(uuid) from anon, authenticated;
revoke execute on function expire_stale_orders() from anon, authenticated;
revoke execute on function refresh_seasonal_collections() from anon, authenticated;
revoke execute on function log_audit_event() from anon, authenticated;
revoke execute on function handle_new_user() from anon, authenticated;
