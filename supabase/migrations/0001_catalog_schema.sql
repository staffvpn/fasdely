create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  description text,
  contacts jsonb not null default '{}'::jsonb,
  status text not null default 'trial' check (status in ('active','trial','suspended','cancelled')),
  subscription_plan text not null default 'start' check (subscription_plan in ('start','pro','network')),
  subscription_status text not null default 'trial' check (subscription_status in ('active','trial','expired','cancelled','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger businesses_set_updated_at before update on businesses
  for each row execute function set_updated_at();

create table locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  address text,
  timezone text not null default 'Europe/Moscow',
  working_hours jsonb not null default '{}'::jsonb,
  order_acceptance_hours jsonb,
  default_prep_time_minutes integer not null default 15,
  qr_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index locations_business_id_idx on locations(business_id);
create trigger locations_set_updated_at before update on locations
  for each row execute function set_updated_at();

create table location_tables (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  label text not null,
  qr_token text unique,
  created_at timestamptz not null default now()
);
create index location_tables_location_id_idx on location_tables(location_id);

create table categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  icon text,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index categories_business_id_idx on categories(business_id);
create trigger categories_set_updated_at before update on categories
  for each row execute function set_updated_at();

create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  description text,
  base_price numeric(10,2) not null check (base_price >= 0),
  image_url text,
  calories numeric(7,2),
  protein_g numeric(6,2),
  fat_g numeric(6,2),
  carbs_g numeric(6,2),
  ingredients text,
  allergens text[] not null default '{}',
  badges text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_business_id_idx on products(business_id);
create index products_category_id_idx on products(category_id);
create trigger products_set_updated_at before update on products
  for each row execute function set_updated_at();

create table product_location_overrides (
  product_id uuid not null references products(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  price_override numeric(10,2) check (price_override is null or price_override >= 0),
  is_available boolean not null default true,
  is_published boolean not null default true,
  primary key (product_id, location_id)
);

create table modifier_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  selection_type text not null default 'single' check (selection_type in ('single','multiple')),
  is_required boolean not null default false,
  min_select integer not null default 0,
  max_select integer,
  created_at timestamptz not null default now()
);
create index modifier_groups_business_id_idx on modifier_groups(business_id);

create table modifiers (
  id uuid primary key default gen_random_uuid(),
  modifier_group_id uuid not null references modifier_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(10,2) not null default 0,
  sort_order integer not null default 0
);
create index modifiers_group_id_idx on modifiers(modifier_group_id);

create table product_modifier_groups (
  product_id uuid not null references products(id) on delete cascade,
  modifier_group_id uuid not null references modifier_groups(id) on delete cascade,
  primary key (product_id, modifier_group_id)
);
