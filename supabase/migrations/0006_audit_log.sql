create table audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  business_id uuid,
  action text not null check (action in ('create','update','delete','publish','unpublish','stop','lift_stop','price_change')),
  before jsonb,
  after jsonb,
  actor_id uuid,
  actor_role text,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log(entity_type, entity_id);
create index audit_log_business_idx on audit_log(business_id);

alter table audit_log enable row level security;
create policy audit_log_operator_read on audit_log for select
  using (auth_role() in ('fasdely_operator','fasdely_admin'));
-- no insert/update/delete policies: only log_audit_event() (security
-- definer) and service-role Edge Functions write to this table.

create or replace function log_audit_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_row jsonb := case when TG_OP = 'DELETE' then v_old else v_new end;
  v_business_id uuid := (v_row->>'business_id')::uuid;
  v_action text;
begin
  if TG_TABLE_NAME = 'stop_list' then
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
    coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid),
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

create trigger products_audit after insert or update or delete on products
  for each row execute function log_audit_event();
create trigger categories_audit after insert or update or delete on categories
  for each row execute function log_audit_event();
create trigger stop_list_audit after insert or update or delete on stop_list
  for each row execute function log_audit_event();
create trigger promotions_audit after insert or update or delete on promotions
  for each row execute function log_audit_event();
create trigger seasonal_collections_audit after insert or update or delete on seasonal_collections
  for each row execute function log_audit_event();
