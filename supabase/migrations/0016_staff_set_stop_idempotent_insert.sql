-- Correction: staff_set_stop's p_stop = true branch used a plain `insert ... values`,
-- so a staff member double-tapping the "Стоп" button (e.g. before the bot's inline
-- keyboard had refreshed to show "Включить") could create duplicate open stop_list
-- rows for the same business/product/location. Switch to an `insert ... select ...
-- where not exists (...)` guard so a second stop call for an already-stopped
-- product+location is a harmless no-op instead of a duplicate row.
create or replace function staff_set_stop(p_telegram_user_id bigint, p_location_id uuid, p_product_id uuid, p_stop boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_business_id uuid;
begin
  select * into v_profile from profiles where telegram_user_id = p_telegram_user_id and status = 'active';
  if v_profile.id is null or v_profile.role not in ('staff', 'business_owner') then
    raise exception 'not_authorized' using errcode = '28000';
  end if;

  select business_id into v_business_id from locations where id = p_location_id;
  if v_business_id is null then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  if v_profile.role = 'staff' and v_profile.location_id is distinct from p_location_id then
    raise exception 'not_authorized' using errcode = '28000';
  end if;
  if v_profile.role = 'business_owner' and v_profile.business_id is distinct from v_business_id then
    raise exception 'not_authorized' using errcode = '28000';
  end if;

  if not exists (select 1 from products where id = p_product_id and business_id = v_business_id) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  perform set_config('fasdely.actor_id', v_profile.id::text, true);

  if p_stop then
    insert into stop_list (business_id, scope_type, scope_id, location_id, created_by)
    select v_business_id, 'product', p_product_id, p_location_id, v_profile.id
    where not exists (
      select 1 from stop_list
      where business_id = v_business_id
        and scope_type = 'product'
        and scope_id = p_product_id
        and location_id = p_location_id
        and lifted_at is null
    );
  else
    update stop_list
    set lifted_at = now()
    where business_id = v_business_id
      and scope_type = 'product'
      and scope_id = p_product_id
      and location_id = p_location_id
      and lifted_at is null;
  end if;

  return jsonb_build_object('ok', true, 'product_id', p_product_id, 'stopped', p_stop);
end;
$$;
