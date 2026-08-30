create table seasonal_collections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status text not null default 'scheduled' check (status in ('scheduled','active','expired','hidden')),
  auto_activate boolean not null default true,
  created_at timestamptz not null default now()
);
create index seasonal_collections_business_id_idx on seasonal_collections(business_id);

create table collection_products (
  collection_id uuid not null references seasonal_collections(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  location_ids uuid[],
  primary key (collection_id, product_id)
);

create table promotions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  discount_type text not null check (discount_type in ('percent','fixed_amount')),
  discount_value numeric(10,2) not null check (discount_value >= 0),
  target_type text not null check (target_type in ('product','category','collection')),
  target_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  status text not null default 'scheduled' check (status in ('scheduled','active','expired','hidden')),
  created_at timestamptz not null default now()
);
create index promotions_business_id_idx on promotions(business_id);

-- business_id is stored directly (not just derived via location_id) so a
-- stop with location_id = null ("all locations") still knows which
-- business it belongs to.
create table stop_list (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  scope_type text not null check (scope_type in ('product','modifier','category','collection')),
  scope_id uuid not null,
  location_id uuid references locations(id) on delete cascade,
  reason text,
  stopped_until timestamptz,
  stopped_for_today boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  lifted_at timestamptz
);
create index stop_list_scope_idx on stop_list(scope_type, scope_id);
create index stop_list_location_idx on stop_list(location_id);
create index stop_list_business_idx on stop_list(business_id);
