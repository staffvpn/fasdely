create or replace function auth_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function auth_business_id() returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from profiles where id = auth.uid();
$$;

create or replace function auth_location_id() returns uuid
language sql stable security definer set search_path = public as $$
  select location_id from profiles where id = auth.uid();
$$;

alter table businesses enable row level security;
alter table locations enable row level security;
alter table location_tables enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table product_location_overrides enable row level security;
alter table modifier_groups enable row level security;
alter table modifiers enable row level security;
alter table product_modifier_groups enable row level security;
alter table seasonal_collections enable row level security;
alter table collection_products enable row level security;
alter table promotions enable row level security;
alter table stop_list enable row level security;
alter table profiles enable row level security;

create policy businesses_operator_all on businesses for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy businesses_owner_read on businesses for select
  using (auth_role() = 'business_owner' and id = auth_business_id());
create policy businesses_staff_read on businesses for select
  using (auth_role() = 'staff' and id = auth_business_id());

create policy locations_operator_all on locations for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy locations_owner_read on locations for select
  using (auth_role() = 'business_owner' and business_id = auth_business_id());
create policy locations_staff_read on locations for select
  using (auth_role() = 'staff' and id = auth_location_id());

create policy location_tables_operator_all on location_tables for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy location_tables_staff_read on location_tables for select
  using (auth_role() = 'staff' and location_id = auth_location_id());

create policy categories_operator_all on categories for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy categories_owner_read on categories for select
  using (auth_role() = 'business_owner' and business_id = auth_business_id());
create policy categories_staff_read on categories for select
  using (auth_role() = 'staff' and business_id = auth_business_id());

create policy products_operator_all on products for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy products_owner_read on products for select
  using (auth_role() = 'business_owner' and business_id = auth_business_id());
create policy products_staff_read on products for select
  using (auth_role() = 'staff' and business_id = auth_business_id());

create policy plo_operator_all on product_location_overrides for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy plo_staff_read on product_location_overrides for select
  using (auth_role() = 'staff' and location_id = auth_location_id());

create policy mg_operator_all on modifier_groups for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy mg_staff_read on modifier_groups for select
  using (auth_role() = 'staff' and business_id = auth_business_id());

create policy modifiers_operator_all on modifiers for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy modifiers_staff_read on modifiers for select
  using (
    auth_role() = 'staff' and exists (
      select 1 from modifier_groups mg
      where mg.id = modifiers.modifier_group_id and mg.business_id = auth_business_id()
    )
  );

create policy pmg_operator_all on product_modifier_groups for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy pmg_staff_read on product_modifier_groups for select
  using (
    auth_role() = 'staff' and exists (
      select 1 from products p where p.id = product_modifier_groups.product_id and p.business_id = auth_business_id()
    )
  );

create policy sc_operator_all on seasonal_collections for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy sc_staff_read on seasonal_collections for select
  using (auth_role() = 'staff' and business_id = auth_business_id());

create policy cp_operator_all on collection_products for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy cp_staff_read on collection_products for select
  using (
    auth_role() = 'staff' and exists (
      select 1 from seasonal_collections sc where sc.id = collection_products.collection_id and sc.business_id = auth_business_id()
    )
  );

create policy promotions_operator_all on promotions for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy promotions_staff_read on promotions for select
  using (auth_role() = 'staff' and business_id = auth_business_id());

create policy stop_list_operator_all on stop_list for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy stop_list_staff_read on stop_list for select
  using (auth_role() = 'staff' and business_id = auth_business_id());

create policy profiles_operator_all on profiles for all
  using (auth_role() in ('fasdely_operator','fasdely_admin'))
  with check (auth_role() in ('fasdely_operator','fasdely_admin'));
create policy profiles_self_read on profiles for select
  using (id = auth.uid());
