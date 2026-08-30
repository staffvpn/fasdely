create extension if not exists pg_cron;

create or replace function expire_stale_orders()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_timeout_minutes integer;
begin
  select (value #>> '{}')::integer into v_timeout_minutes
  from platform_settings where key = 'order_expiration_minutes';

  with expired as (
    update orders
    set status = 'expired'
    where status in ('new', 'waiting_confirmation')
      and created_at < now() - make_interval(mins => coalesce(v_timeout_minutes, 15))
    returning id, status
  )
  insert into order_events (order_id, event_type, from_status, to_status, actor_type, reason)
  select id, 'status_change', 'new', 'expired', 'system', 'auto-expired: not accepted in time'
  from expired;
end;
$$;

create or replace function refresh_seasonal_collections()
returns void language plpgsql security definer set search_path = public as $$
begin
  update seasonal_collections
  set status = 'active'
  where auto_activate and status in ('scheduled', 'expired')
    and current_date between start_date and end_date;

  update seasonal_collections
  set status = 'expired'
  where auto_activate and status = 'active'
    and current_date > end_date;
end;
$$;

select cron.schedule('expire-stale-orders', '* * * * *', 'select expire_stale_orders();');
select cron.schedule('refresh-seasonal-collections', '0 * * * *', 'select refresh_seasonal_collections();');
