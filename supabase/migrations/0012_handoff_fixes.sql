-- Fixes from the final whole-branch review of the backend-foundation branch
-- (16 tasks, all individually reviewed and merged). This migration bundles
-- every schema/SQL-level fix from that review; corresponding Edge Function
-- code changes are shipped in the same commit as this migration.

-- ---------------------------------------------------------------------------
-- Fix 1 [Critical]: privilege escalation via raw_user_meta_data.
-- raw_user_meta_data is attacker-controlled on public signup (any caller of
-- Supabase Auth's signup endpoint can set arbitrary user_metadata). The
-- original handle_new_user() (0003) read role/business_id/location_id from
-- it, so any anonymous signup could self-provision as fasdely_admin.
-- raw_app_meta_data is service-role only (never client-settable), so move
-- the three privileged fields there. full_name intentionally stays on
-- raw_user_meta_data: a client-settable display name has no privilege
-- implication.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, business_id, location_id, full_name)
  values (
    new.id,
    coalesce(new.raw_app_meta_data->>'role', 'staff'),
    nullif(new.raw_app_meta_data->>'business_id', '')::uuid,
    nullif(new.raw_app_meta_data->>'location_id', '')::uuid,
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 2 [Important]: profiles.status = 'disabled' was not enforced anywhere.
-- auth_role()/auth_business_id()/auth_location_id() back every RLS policy in
-- the schema; add `and status = 'active'` so a disabled profile loses all
-- RLS-derived access the moment it's disabled, without needing to touch
-- every policy individually.
create or replace function auth_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'active';
$$;

create or replace function auth_business_id() returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from profiles where id = auth.uid() and status = 'active';
$$;

create or replace function auth_location_id() returns uuid
language sql stable security definer set search_path = public as $$
  select location_id from profiles where id = auth.uid() and status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Fix 3 [Important] (defense in depth): non-negative floors on order money
-- columns. The real fix (scoping create-order's modifier lookup to the
-- product's own business and rejecting unknown modifier ids) is in
-- create-order/index.ts + logic.ts, shipped in this same commit. These
-- floors are a second line of defense against a negative subtotal/total/
-- line amount reaching the database by any path. Deliberately NOT applied to
-- modifiers.price_delta itself — a legitimate modifier (e.g. a size
-- downgrade) can have a negative delta; only the final computed order/item
-- amounts need a floor.
alter table orders add constraint orders_subtotal_nonneg check (subtotal >= 0);
alter table orders add constraint orders_total_nonneg check (total >= 0);
alter table order_items add constraint order_items_unit_price_nonneg check (unit_price_snapshot >= 0);
alter table order_items add constraint order_items_line_total_nonneg check (line_total >= 0);

-- ---------------------------------------------------------------------------
-- Fix 4 [Important]: idempotency key was scoped only to (location_id,
-- idempotency_key), so two different guests at the same location choosing
-- the same idempotency key (e.g. both clients seed it from a low-entropy
-- source) would collide and the second guest would silently receive the
-- first guest's order back. Scope it per-guest too. Actual pre-existing
-- constraint name confirmed live via pg_constraint before writing this:
-- orders_location_id_idempotency_key_key (Postgres's auto-generated name for
-- the inline `unique (location_id, idempotency_key)` in 0005_orders.sql).
alter table orders drop constraint if exists orders_location_id_idempotency_key_key;
alter table orders add constraint orders_location_guest_idempotency_key unique (location_id, guest_telegram_user_id, idempotency_key);

-- ---------------------------------------------------------------------------
-- Fix 5 [Important]: product_location_overrides had no audit_log coverage.
-- Unlike the other 5 audited tables it has a composite PK (product_id,
-- location_id) instead of an `id` column, and no `business_id` column, so
-- log_audit_event() needs a dedicated branch: business_id is derived via a
-- subquery to products, and entity_id uses product_id in place of the
-- missing id column. Full existing function body preserved verbatim below
-- (read from 0006_audit_log.sql before editing) with only the addition of
-- a v_entity_id variable (previously an inline expression) and the new
-- product_location_overrides branch.
create or replace function log_audit_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_row jsonb := case when TG_OP = 'DELETE' then v_old else v_new end;
  v_business_id uuid := (v_row->>'business_id')::uuid;
  v_entity_id uuid := coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid);
  v_action text;
begin
  if TG_TABLE_NAME = 'product_location_overrides' then
    v_entity_id := coalesce((v_new->>'product_id')::uuid, (v_old->>'product_id')::uuid);
    select business_id into v_business_id from products where id = v_entity_id;

    if TG_OP = 'INSERT' then
      v_action := 'create';
    elsif TG_OP = 'DELETE' then
      v_action := 'delete';
    elsif (v_old->>'price_override') is distinct from (v_new->>'price_override') then
      v_action := 'price_change';
    else
      v_action := 'update';
    end if;
  elsif TG_TABLE_NAME = 'stop_list' then
    if TG_OP = 'INSERT' then
      v_action := 'stop';
    elsif TG_OP = 'DELETE' then
      v_action := 'delete';
    elsif (v_old->>'lifted_at') is null and (v_new->>'lifted_at') is not null then
      v_action := 'lift_stop';
    else
      v_action := 'update';
    end if;
  elsif TG_OP = 'INSERT' then
    v_action := 'create';
  elsif TG_OP = 'DELETE' then
    v_action := 'delete';
  elsif (v_old->>'status') is distinct from (v_new->>'status') and (v_new->>'status') = 'published' then
    v_action := 'publish';
  elsif (v_old->>'status') is distinct from (v_new->>'status') and (v_old->>'status') = 'published' then
    v_action := 'unpublish';
  elsif (v_old->>'base_price') is distinct from (v_new->>'base_price') then
    v_action := 'price_change';
  else
    v_action := 'update';
  end if;

  insert into audit_log (entity_type, entity_id, business_id, action, before, after, actor_id, actor_role)
  values (
    TG_TABLE_NAME,
    v_entity_id,
    v_business_id,
    v_action,
    case when TG_OP = 'INSERT' then null else v_old end,
    case when TG_OP = 'DELETE' then null else v_new end,
    auth.uid(),
    auth_role()
  );

  return coalesce(new, old);
end;
$$;

create trigger product_location_overrides_audit after insert or update or delete on product_location_overrides
  for each row execute function log_audit_event();

-- ---------------------------------------------------------------------------
-- Fix 6 [Important]: staff could bypass the state machine and delete the
-- audit trail via direct PostgREST access, because orders/order_items/
-- order_events RLS policies granted staff `for all` (select+insert+update+
-- delete) instead of read-only. All 3 order-writing Edge Functions
-- (create-order, update-order-status, cancel-order) use the SERVICE ROLE
-- client for every DB write on these tables — none of them rely on the
-- staff member's own RLS-scoped session to write — so narrowing staff to
-- read-only here does not break any deployed function.
drop policy orders_staff_own_location on orders;
create policy orders_staff_own_location on orders for select
  using (auth_role() = 'staff' and location_id = auth_location_id());

drop policy order_items_staff_own_location on order_items;
create policy order_items_staff_own_location on order_items for select
  using (
    auth_role() = 'staff' and exists (
      select 1 from orders o where o.id = order_items.order_id and o.location_id = auth_location_id()
    )
  );

drop policy order_events_staff_own_location on order_events;
create policy order_events_staff_own_location on order_events for select
  using (
    auth_role() = 'staff' and exists (
      select 1 from orders o where o.id = order_events.order_id and o.location_id = auth_location_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Fix 7a [Important]: expire_stale_orders() hardcoded from_status: 'new' in
-- the order_events insert regardless of the order's actual prior status —
-- a plain `UPDATE ... RETURNING` cannot see pre-update values, so orders
-- that were in waiting_confirmation got a false from_status. Restructured
-- to capture the old status via a `SELECT ... FOR UPDATE` CTE before the
-- update.
create or replace function expire_stale_orders()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_timeout_minutes integer;
begin
  select (value #>> '{}')::integer into v_timeout_minutes
  from platform_settings where key = 'order_expiration_minutes';

  with stale as (
    select id, status as old_status
    from orders
    where status in ('new', 'waiting_confirmation')
      and created_at < now() - make_interval(mins => coalesce(v_timeout_minutes, 15))
    for update
  ), expired as (
    update orders
    set status = 'expired'
    from stale
    where orders.id = stale.id
    returning orders.id, stale.old_status
  )
  insert into order_events (order_id, event_type, from_status, to_status, actor_type, reason)
  select id, 'status_change', old_status, 'expired', 'system', 'auto-expired: not accepted in time'
  from expired;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 8 [Important]: Realtime was never enabled on orders/order_events, so
-- staff dashboards and guest order-status screens (planned for later
-- sub-projects) have no live-update channel to subscribe to yet.
alter publication supabase_realtime add table orders, order_events;
