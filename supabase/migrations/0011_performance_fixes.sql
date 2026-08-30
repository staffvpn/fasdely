-- Fixes for the two performance-advisor findings that map to a real, currently-issued
-- query pattern (per the plan's YAGNI instruction — every other finding was either
-- already-documented-by-design multi-policy overhead, an unindexed FK with no real
-- query path in the deployed Edge Functions yet, or a false "unused index" reading
-- from a fresh database with no real production traffic).
-- https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
-- https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

-- profiles_self_read calls auth.uid() directly, which Postgres re-evaluates per row
-- instead of once per query; wrapping it in a scalar subselect fixes that.
drop policy profiles_self_read on profiles;
create policy profiles_self_read on profiles for select
  using (id = (select auth.uid()));

-- product_location_overrides.location_id backs the plo_staff_read RLS policy's
-- location_id = auth_location_id() filter, which runs on every staff-role query
-- against this table (get-menu and create-order both read this table per request).
create index product_location_overrides_location_id_idx on product_location_overrides(location_id);
