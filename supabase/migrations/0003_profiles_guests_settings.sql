create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('staff','business_owner','fasdely_operator','fasdely_admin')),
  business_id uuid references businesses(id) on delete set null,
  location_id uuid references locations(id) on delete set null,
  full_name text,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);

create table guests (
  telegram_user_id bigint primary key,
  first_name text,
  username text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into platform_settings (key, value) values
  ('subscription_pricing', '{"start": 1490, "pro": 2990, "network": 5990, "currency": "RUB"}'),
  ('setup_fee', '{"start": 2990, "pro": 4990, "network": null, "currency": "RUB"}'),
  ('order_expiration_minutes', '15'),
  ('cancellable_statuses', '["new", "waiting_confirmation", "accepted"]');

-- Staff/operator/owner accounts are provisioned by a FASDELY admin via
-- Supabase Auth (email+password) with role/business_id/location_id passed
-- as user metadata; this trigger turns that signup into a profiles row.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, business_id, location_id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'staff'),
    nullif(new.raw_user_meta_data->>'business_id', '')::uuid,
    nullif(new.raw_user_meta_data->>'location_id', '')::uuid,
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
