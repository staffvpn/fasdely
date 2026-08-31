CREATE OR REPLACE FUNCTION public.log_audit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    coalesce(nullif(current_setting('fasdely.actor_id', true), '')::uuid, auth.uid()),
    coalesce(
      (select role from profiles where id = nullif(current_setting('fasdely.actor_id', true), '')::uuid),
      auth_role()
    )
  );

  return coalesce(new, old);
end;
$function$
