create table order_number_counters (
  location_id uuid not null references locations(id) on delete cascade,
  day date not null,
  last_number integer not null default 0,
  primary key (location_id, day)
);

create or replace function next_order_number(p_location_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_number integer;
begin
  insert into order_number_counters (location_id, day, last_number)
  values (p_location_id, current_date, 1)
  on conflict (location_id, day)
  do update set last_number = order_number_counters.last_number + 1
  returning last_number into v_number;
  return v_number;
end;
$$;

create table orders (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete restrict,
  table_id uuid references location_tables(id) on delete set null,
  guest_telegram_user_id bigint not null,
  order_type text not null check (order_type in ('dine_in','takeaway')),
  requested_time_mode text not null default 'asap' check (requested_time_mode in ('asap','scheduled')),
  requested_time timestamptz,
  status text not null default 'new' check (status in (
    'new','waiting_confirmation','accepted','preparing','ready','handed_out',
    'cancelled_by_guest','cancelled_by_establishment','expired','problem'
  )),
  comment text,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  currency text not null default 'RUB',
  order_number integer not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, idempotency_key)
);
create index orders_location_id_idx on orders(location_id);
create index orders_status_idx on orders(status);
create trigger orders_set_updated_at before update on orders
  for each row execute function set_updated_at();

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  product_name_snapshot text not null,
  unit_price_snapshot numeric(10,2) not null,
  quantity integer not null check (quantity > 0),
  modifiers_snapshot jsonb not null default '[]'::jsonb,
  line_total numeric(10,2) not null
);
create index order_items_order_id_idx on order_items(order_id);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  event_type text not null check (event_type in ('status_change','comment','cancellation')),
  from_status text,
  to_status text,
  actor_type text not null check (actor_type in ('guest','staff','system')),
  actor_id text,
  reason text,
  created_at timestamptz not null default now()
);
create index order_events_order_id_idx on order_events(order_id);

alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_events enable row level security;
alter table order_number_counters enable row level security;
-- order_number_counters has no policies: only next_order_number() (security
-- definer) and service-role Edge Functions touch it.

create policy orders_operator_all on orders for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy orders_staff_own_location on orders for all
  using (auth_role() = 'staff' and location_id = auth_location_id())
  with check (auth_role() = 'staff' and location_id = auth_location_id());
create policy orders_owner_read on orders for select
  using (
    auth_role() = 'business_owner' and exists (
      select 1 from locations l where l.id = orders.location_id and l.business_id = auth_business_id()
    )
  );

create policy order_items_operator_all on order_items for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy order_items_staff_own_location on order_items for all
  using (
    auth_role() = 'staff' and exists (
      select 1 from orders o where o.id = order_items.order_id and o.location_id = auth_location_id()
    )
  )
  with check (
    auth_role() = 'staff' and exists (
      select 1 from orders o where o.id = order_items.order_id and o.location_id = auth_location_id()
    )
  );

create policy order_events_operator_all on order_events for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy order_events_staff_own_location on order_events for all
  using (
    auth_role() = 'staff' and exists (
      select 1 from orders o where o.id = order_events.order_id and o.location_id = auth_location_id()
    )
  )
  with check (
    auth_role() = 'staff' and exists (
      select 1 from orders o where o.id = order_events.order_id and o.location_id = auth_location_id()
    )
  );
