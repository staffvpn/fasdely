# FASDELY Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-tenant Postgres schema, RLS-based tenant isolation, and core Edge Functions (menu retrieval, order placement, order status transitions, guest cancellation, minimal Telegram webhook) that every future FASDELY frontend (guest Mini App, staff app, admin dashboard) will call into.

**Architecture:** Pure Supabase — Postgres + Row Level Security + auto-generated PostgREST API for authenticated staff/operator CRUD, plus Deno Edge Functions for guest-facing logic (Telegram `initData` verification, server-side price recomputation, order state machine) and `pg_cron` for scheduled jobs. Business logic in each Edge Function is split into a pure, dependency-free `logic.ts` (unit-tested with Vitest on Node — no Docker/Deno required locally) and a thin `index.ts` HTTP/DB adapter (deployed to Deno, smoke-tested against the live project after deploy).

**Tech Stack:** PostgreSQL 17 (Supabase), Supabase Edge Functions (Deno, TypeScript), Supabase Realtime, `pg_cron`, Vitest (Node) for unit tests, Supabase MCP tools (`apply_migration`, `deploy_edge_function`, `execute_sql`, `get_advisors`) for applying changes to the already-provisioned remote project.

**Spec:** `docs/superpowers/specs/2026-08-30-backend-foundation-design.md`

## Global Constraints

- Zero paid infrastructure — Supabase Free tier only, no other services.
- Guests never receive a Supabase Auth account; all guest-facing endpoints verify Telegram `initData` server-side instead.
- Order prices are always recomputed server-side at `create-order` — never trust a client-supplied price.
- Every order status change (by guest, staff, or system) is written to `order_events`, distinguishing `actor_type`.
- Every table holding tenant data has Row Level Security enabled; `fasdely_operator`/`fasdely_admin` get full access, `business_owner`/`staff` get read-only access scoped to their own business/location.
- Menu-management mutations (products, categories, stop_list, promotions, seasonal_collections) are captured in `audit_log` automatically via triggers — never fabricated, never optional.
- Supabase project: `fasdely`, project_id `rlxbhbdcecrnykwxnqtx`, region `eu-west-1`. All `apply_migration` / `deploy_edge_function` / `execute_sql` calls in this plan target this `project_id`.
- No AI, no online payments, no automated billing — explicitly out of scope (product prompt sections 31, 33).

---

## File Structure

```
fasdely/
├── package.json                    # Vitest + TypeScript devDependencies, root scripts
├── vitest.config.ts
├── tsconfig.json
├── .gitignore
├── README.md
├── supabase/
│   ├── config.toml                 # project_id link for the Supabase CLI
│   ├── migrations/
│   │   ├── 0001_catalog_schema.sql
│   │   ├── 0002_collections_promotions_stoplist.sql
│   │   ├── 0003_profiles_guests_settings.sql
│   │   ├── 0004_rls_catalog.sql
│   │   ├── 0005_orders.sql
│   │   ├── 0006_audit_log.sql
│   │   ├── 0007_menu_quality.sql
│   │   └── 0008_cron_jobs.sql
│   └── functions/
│       ├── _shared/
│       │   ├── telegramAuth.ts
│       │   ├── telegramAuth.test.ts
│       │   ├── orderStateMachine.ts
│       │   ├── orderStateMachine.test.ts
│       │   ├── timeWindow.ts
│       │   └── timeWindow.test.ts
│       ├── get-menu/
│       │   ├── logic.ts
│       │   ├── logic.test.ts
│       │   └── index.ts
│       ├── create-order/
│       │   ├── logic.ts
│       │   ├── logic.test.ts
│       │   └── index.ts
│       ├── update-order-status/
│       │   └── index.ts
│       ├── cancel-order/
│       │   ├── logic.ts
│       │   ├── logic.test.ts
│       │   └── index.ts
│       └── telegram-webhook/
│           ├── logic.ts
│           ├── logic.test.ts
│           └── index.ts
└── docs/superpowers/{specs,plans}/  # already contains this plan + the design spec
```

---

### Task 1: Repo scaffolding & test tooling

**Files:**
- Create: `package.json`
- Create: `vitest.config.ts`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `supabase/config.toml`

**Interfaces:**
- Produces: `npx vitest run` as the test command every later task uses.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "fasdely-backend",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.7.0"
  }
}
```

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["supabase/functions/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["supabase/functions/**/*.ts"]
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
.env
.env.*
dist/
```

- [ ] **Step 5: Write `supabase/config.toml`**

```toml
project_id = "rlxbhbdcecrnykwxnqtx"
```

- [ ] **Step 6: Write `README.md`**

```markdown
# FASDELY — Backend Foundation

Multi-tenant Supabase backend for FASDELY (Telegram café ordering platform).
Design: `docs/superpowers/specs/2026-08-30-backend-foundation-design.md`.

- Pure Supabase: Postgres + RLS + PostgREST + Edge Functions + pg_cron.
- Migrations in `supabase/migrations/`, applied via the Supabase MCP
  `apply_migration` tool against project `rlxbhbdcecrnykwxnqtx` (no local
  Docker/Supabase CLI stack is used in this environment).
- Edge Functions in `supabase/functions/`; each has a dependency-free
  `logic.ts` unit-tested with Vitest, and a thin `index.ts` deployed via the
  `deploy_edge_function` MCP tool.

Run tests: `npm install && npm test`
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: installs without errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 8: Verify the test runner works with zero tests**

Run: `npx vitest run --passWithNoTests`
Expected: PASS (no test files yet).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold repo and test tooling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Core catalog schema (businesses, locations, categories, products, modifiers)

**Files:**
- Create: `supabase/migrations/0001_catalog_schema.sql`

**Interfaces:**
- Produces: tables `businesses`, `locations`, `location_tables`, `categories`,
  `products`, `product_location_overrides`, `modifier_groups`, `modifiers`,
  `product_modifier_groups`; function `set_updated_at()`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0001_catalog_schema.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration to the remote project**

Use the Supabase MCP tool `apply_migration` with:
- `project_id`: `rlxbhbdcecrnykwxnqtx`
- `name`: `catalog_schema`
- `query`: the full contents of `supabase/migrations/0001_catalog_schema.sql`

Expected: success, no errors.

- [ ] **Step 3: Verify with a round-trip insert/select**

Use the Supabase MCP tool `execute_sql` with `project_id` `rlxbhbdcecrnykwxnqtx`:

```sql
with b as (
  insert into businesses (name) values ('__smoke_test_business__') returning id
), l as (
  insert into locations (business_id, name)
  select id, '__smoke_test_location__' from b returning id, business_id
), c as (
  insert into categories (business_id, name)
  select business_id, '__smoke_test_category__' from l returning id, business_id
), p as (
  insert into products (business_id, category_id, name, base_price, status)
  select business_id, id, '__smoke_test_product__', 100, 'published' from c returning id
)
select
  (select count(*) from businesses where name = '__smoke_test_business__') as businesses,
  (select count(*) from locations where name = '__smoke_test_location__') as locations,
  (select count(*) from products where name = '__smoke_test_product__') as products;
```

Expected: `businesses=1, locations=1, products=1`.

- [ ] **Step 4: Clean up smoke-test rows**

```sql
delete from businesses where name = '__smoke_test_business__';
```

Expected: cascades delete the location/category/product created above (all reference `businesses` with `on delete cascade`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_catalog_schema.sql
git commit -m "feat: core catalog schema (businesses, locations, products, modifiers)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Seasonal collections, promotions, stop-list schema

**Files:**
- Create: `supabase/migrations/0002_collections_promotions_stoplist.sql`

**Interfaces:**
- Consumes: `businesses`, `products`, `locations` (Task 2).
- Produces: tables `seasonal_collections`, `collection_products`,
  `promotions`, `stop_list`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0002_collections_promotions_stoplist.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Use `apply_migration` (`project_id` `rlxbhbdcecrnykwxnqtx`, `name` `collections_promotions_stoplist`, `query` = file contents above).

- [ ] **Step 3: Verify with a round-trip insert/select**

```sql
with b as (
  insert into businesses (name) values ('__smoke_test_business_2__') returning id
), sc as (
  insert into seasonal_collections (business_id, name, start_date, end_date)
  select id, 'Summer 2026', '2026-06-01', '2026-08-31' from b returning id, business_id
), sl as (
  insert into stop_list (business_id, scope_type, scope_id)
  select business_id, 'category', gen_random_uuid() from sc returning id
)
select
  (select count(*) from seasonal_collections where name = 'Summer 2026') as collections,
  (select count(*) from stop_list where id in (select id from sl)) as stops;
```

Expected: `collections=1, stops=1`.

- [ ] **Step 4: Clean up**

```sql
delete from businesses where name = '__smoke_test_business_2__';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_collections_promotions_stoplist.sql
git commit -m "feat: seasonal collections, promotions, stop-list schema

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Profiles, guests, platform settings, auth trigger

**Files:**
- Create: `supabase/migrations/0003_profiles_guests_settings.sql`

**Interfaces:**
- Consumes: `businesses`, `locations` (Task 2); `auth.users` (built into Supabase).
- Produces: tables `profiles`, `guests`, `platform_settings`; function
  `handle_new_user()`; trigger `on_auth_user_created`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0003_profiles_guests_settings.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Use `apply_migration` (`project_id` `rlxbhbdcecrnykwxnqtx`, `name` `profiles_guests_settings`, `query` = file contents above).

- [ ] **Step 3: Verify the auth trigger**

```sql
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(), 'authenticated', 'authenticated',
  '__smoke_test_staff__@fasdely.test', crypt('placeholder', gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}',
  '{"role":"fasdely_operator","full_name":"Smoke Test Operator"}',
  now(), now()
);

select role, full_name from profiles
where id = (select id from auth.users where email = '__smoke_test_staff__@fasdely.test');
```

Expected: one row, `role='fasdely_operator'`, `full_name='Smoke Test Operator'`.

- [ ] **Step 4: Clean up**

```sql
delete from auth.users where email = '__smoke_test_staff__@fasdely.test';
```

Expected: cascades to delete the `profiles` row too.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_profiles_guests_settings.sql
git commit -m "feat: profiles, guests, platform settings, signup trigger

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: RLS helper functions and tenant-isolation policies (catalog tables)

**Files:**
- Create: `supabase/migrations/0004_rls_catalog.sql`

**Interfaces:**
- Consumes: all catalog tables (Task 2, 3), `profiles` (Task 4).
- Produces: functions `auth_role()`, `auth_business_id()`, `auth_location_id()`;
  RLS enabled + policies on every catalog table and `profiles`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0004_rls_catalog.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Use `apply_migration` (`project_id` `rlxbhbdcecrnykwxnqtx`, `name` `rls_catalog`, `query` = file contents above).

- [ ] **Step 3: Verify tenant isolation by role-switching in SQL**

This uses the standard Supabase technique for testing RLS from plain SQL: set
the session `request.jwt.claims` and switch to the `authenticated` role
within one `execute_sql` call, so `auth.uid()` (which reads that GUC)
resolves to a specific test user.

```sql
-- setup: two businesses, one operator, one staff member scoped to business A
insert into businesses (id, name) values
  ('11111111-1111-1111-1111-111111111111', '__rls_test_business_a__'),
  ('22222222-2222-2222-2222-222222222222', '__rls_test_business_b__');

insert into locations (id, business_id, name) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '__rls_test_location_a__');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated',
  '__rls_test_staff__@fasdely.test', crypt('placeholder', gen_salt('bf')),
  now(), '{}', '{"role":"staff","location_id":"33333333-3333-3333-3333-333333333333","business_id":"11111111-1111-1111-1111-111111111111"}',
  now(), now()
);

-- as staff scoped to business A: should see business A, not business B
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select id, name from businesses order by name;
reset role;
reset request.jwt.claims;
```

Expected: the `select` while impersonating staff returns exactly one row —
`__rls_test_business_a__` — never `__rls_test_business_b__`, proving tenant
isolation.

- [ ] **Step 4: Clean up**

```sql
delete from auth.users where email = '__rls_test_staff__@fasdely.test';
delete from businesses where name in ('__rls_test_business_a__', '__rls_test_business_b__');
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0004_rls_catalog.sql
git commit -m "feat: RLS tenant isolation for catalog tables and profiles

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Orders schema, order numbering, order RLS

**Files:**
- Create: `supabase/migrations/0005_orders.sql`

**Interfaces:**
- Consumes: `locations`, `location_tables`, `products` (Task 2); `auth_role()`,
  `auth_location_id()`, `auth_business_id()` (Task 5).
- Produces: tables `orders`, `order_items`, `order_events`,
  `order_number_counters`; function `next_order_number(uuid) returns integer`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0005_orders.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Use `apply_migration` (`project_id` `rlxbhbdcecrnykwxnqtx`, `name` `orders`, `query` = file contents above).

- [ ] **Step 3: Verify order numbering is atomic and per-location-per-day**

```sql
select next_order_number('33333333-3333-3333-3333-333333333333'::uuid) as should_error;
```

Expected: fails with a foreign key violation (no such location) — confirms
the function enforces a real `location_id`. Then with a real location:

```sql
with b as (
  insert into businesses (name) values ('__order_smoke_test__') returning id
), l as (
  insert into locations (business_id, name) select id, 'loc' from b returning id
)
select
  next_order_number((select id from l)) as n1,
  next_order_number((select id from l)) as n2;
```

Expected: `n1=1, n2=2` (sequential, same location, same day).

- [ ] **Step 4: Clean up**

```sql
delete from businesses where name = '__order_smoke_test__';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_orders.sql
git commit -m "feat: orders, order_items, order_events schema with atomic order numbering

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Audit log with automatic triggers

**Files:**
- Create: `supabase/migrations/0006_audit_log.sql`

**Interfaces:**
- Consumes: `products`, `categories`, `stop_list`, `promotions`,
  `seasonal_collections` (Tasks 2-3); `auth_role()` (Task 5).
- Produces: table `audit_log`; function `log_audit_event()`; triggers on the
  five tables above.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0006_audit_log.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Use `apply_migration` (`project_id` `rlxbhbdcecrnykwxnqtx`, `name` `audit_log`, `query` = file contents above).

- [ ] **Step 3: Verify a price change is captured**

```sql
with b as (
  insert into businesses (name) values ('__audit_smoke_test__') returning id
), c as (
  insert into categories (business_id, name) select id, 'cat' from b returning id, business_id
), p as (
  insert into products (business_id, category_id, name, base_price, status)
  select business_id, id, 'Cappuccino', 280, 'published' from c returning id
)
update products set base_price = 320 where id = (select id from p);

select action, before->>'base_price' as old_price, after->>'base_price' as new_price
from audit_log
where entity_type = 'products'
order by created_at desc
limit 1;
```

Expected: one row, `action='price_change'`, `old_price=280.00`, `new_price=320.00`.

- [ ] **Step 4: Clean up**

```sql
delete from businesses where name = '__audit_smoke_test__';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_audit_log.sql
git commit -m "feat: audit log with automatic triggers on menu-management tables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Menu quality score view

**Files:**
- Create: `supabase/migrations/0007_menu_quality.sql`

**Interfaces:**
- Consumes: `products` (Task 2).
- Produces: view `menu_quality_by_business`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0007_menu_quality.sql`:

```sql
create or replace view menu_quality_by_business as
select
  business_id,
  count(*) filter (where status = 'published') as published_products,
  count(*) filter (where status = 'published' and image_url is not null) as with_image,
  count(*) filter (where status = 'published' and description is not null and description <> '') as with_description,
  count(*) filter (where status = 'published' and calories is not null) as with_calories,
  count(*) filter (where status = 'published' and array_length(allergens, 1) > 0) as with_allergens,
  count(*) filter (where status = 'published' and base_price is not null) as with_price,
  case when count(*) filter (where status = 'published') = 0 then null
    else round(
      100.0 * (
        count(*) filter (where status = 'published' and image_url is not null) +
        count(*) filter (where status = 'published' and description is not null and description <> '') +
        count(*) filter (where status = 'published' and calories is not null) +
        count(*) filter (where status = 'published' and array_length(allergens, 1) > 0) +
        count(*) filter (where status = 'published' and base_price is not null)
      ) / (5.0 * count(*) filter (where status = 'published')),
      1
    )
  end as quality_score_pct
from products
group by business_id;

alter view menu_quality_by_business set (security_invoker = true);
```

- [ ] **Step 2: Apply the migration**

Use `apply_migration` (`project_id` `rlxbhbdcecrnykwxnqtx`, `name` `menu_quality`, `query` = file contents above).

- [ ] **Step 3: Verify the score calculation**

```sql
with b as (
  insert into businesses (name) values ('__quality_smoke_test__') returning id
), complete as (
  insert into products (business_id, name, base_price, status, image_url, description, calories, allergens)
  select id, 'Complete Product', 100, 'published', 'http://x/img.png', 'desc', 250, array['milk'] from b returning id
), incomplete as (
  insert into products (business_id, name, base_price, status)
  select id, 'Incomplete Product', 100, 'published' from b returning id
)
select business_id, published_products, quality_score_pct
from menu_quality_by_business
where business_id = (select id from b);
```

Expected: `published_products=2`, `quality_score_pct=60.0`. The "Complete
Product" satisfies all 5 criteria; the "Incomplete Product" satisfies only
`with_price` (`base_price` is `NOT NULL`, so it's always set — note
`allergens` defaults to `'{}'`, and Postgres's `array_length('{}', 1)`
returns `NULL`, not `0`, so the empty-array case correctly fails the
`with_allergens` criterion rather than needing special-casing). Total:
`(1+1+1+1+2) / (5*2) * 100 = 60.0`.

- [ ] **Step 4: Clean up**

```sql
delete from businesses where name = '__quality_smoke_test__';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_menu_quality.sql
git commit -m "feat: menu quality score view

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: pg_cron — order expiration and seasonal collection activation

**Files:**
- Create: `supabase/migrations/0008_cron_jobs.sql`

**Interfaces:**
- Consumes: `orders`, `order_events` (Task 6); `seasonal_collections` (Task 3);
  `platform_settings` (Task 4).
- Produces: functions `expire_stale_orders()`, `refresh_seasonal_collections()`;
  two `pg_cron` schedules.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0008_cron_jobs.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Use `apply_migration` (`project_id` `rlxbhbdcecrnykwxnqtx`, `name` `cron_jobs`, `query` = file contents above).

- [ ] **Step 3: Verify `expire_stale_orders()` directly (don't wait for the cron minute)**

```sql
with b as (
  insert into businesses (name) values ('__cron_smoke_test__') returning id
), l as (
  insert into locations (business_id, name) select id, 'loc' from b returning id
), o as (
  insert into orders (location_id, guest_telegram_user_id, order_type, status, order_number, idempotency_key, created_at)
  select id, 1, 'takeaway', 'new', 1, 'smoke-1', now() - interval '30 minutes' from l returning id
)
select expire_stale_orders();

select status from orders where id = (select id from o);
select event_type, to_status from order_events where order_id = (select id from o);
```

Expected: `status='expired'`; one `order_events` row with `to_status='expired'`.

- [ ] **Step 4: Verify `refresh_seasonal_collections()` directly**

```sql
with b as (
  insert into businesses (name) values ('__cron_smoke_test_2__') returning id
), sc as (
  insert into seasonal_collections (business_id, name, start_date, end_date, status)
  select id, 'Should Activate', current_date - 1, current_date + 1, 'scheduled' from b returning id
)
select refresh_seasonal_collections();

select status from seasonal_collections where id = (select id from sc);
```

Expected: `status='active'`.

- [ ] **Step 5: Clean up**

```sql
delete from businesses where name in ('__cron_smoke_test__', '__cron_smoke_test_2__');
select cron.unschedule('expire-stale-orders') where exists (
  select 1 from cron.job where jobname = 'expire-stale-orders'
); -- do NOT actually run this line for real — it's listed only so a reviewer
   -- knows how to remove the job if this task is ever reverted; leave the
   -- schedules in place after verification.
```

Run only the `delete from businesses ...` line for cleanup; leave the two
`cron.schedule(...)` jobs active.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0008_cron_jobs.sql
git commit -m "feat: pg_cron jobs for order expiration and seasonal collection activation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Shared Edge Function logic — Telegram auth, order state machine, time windows

**Files:**
- Create: `supabase/functions/_shared/telegramAuth.ts`
- Create: `supabase/functions/_shared/telegramAuth.test.ts`
- Create: `supabase/functions/_shared/orderStateMachine.ts`
- Create: `supabase/functions/_shared/orderStateMachine.test.ts`
- Create: `supabase/functions/_shared/timeWindow.ts`
- Create: `supabase/functions/_shared/timeWindow.test.ts`

**Interfaces:**
- Produces:
  - `verifyTelegramInitData(initData: string, botToken: string, maxAgeSeconds?: number): Promise<{valid: boolean; reason?: string; data?: Record<string,string>; user?: {id: number; first_name?: string; username?: string}}>`
  - `type OrderStatus = 'new' | 'waiting_confirmation' | 'accepted' | 'preparing' | 'ready' | 'handed_out' | 'cancelled_by_guest' | 'cancelled_by_establishment' | 'expired' | 'problem'`
  - `canStaffTransition(from: OrderStatus, to: OrderStatus): boolean`
  - `canGuestCancel(status: OrderStatus, cancellableStatuses?: OrderStatus[]): boolean`
  - `type WeeklySchedule = Partial<Record<'sun'|'mon'|'tue'|'wed'|'thu'|'fri'|'sat', {open: string; close: string; closed?: boolean}>>`
  - `isWithinSchedule(at: Date, schedule: WeeklySchedule, timezone: string): boolean`
  - `validateRequestedTime(mode: 'asap'|'scheduled', requestedAt: Date|null, now: Date, schedule: WeeklySchedule, timezone: string, prepTimeMinutes: number): {ok: boolean; reason?: 'location_closed'|'too_soon'|'outside_hours'}`

- [ ] **Step 1: Write the failing tests**

`supabase/functions/_shared/telegramAuth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { verifyTelegramInitData } from "./telegramAuth.ts";

const BOT_TOKEN = "123456:TEST-token-for-fixture-only";
// Generated once with Node's crypto module, following Telegram's documented
// WebApp initData algorithm: secret_key = HMAC_SHA256(key="WebAppData",
// data=bot_token); hash = HMAC_SHA256(key=secret_key, data=data_check_string).
const VALID_INIT_DATA =
  "auth_date=1700000000&query_id=AAHdF6IAAAAA0y9C7A&" +
  "user=%7B%22id%22%3A987654321%2C%22first_name%22%3A%22Ivan%22%2C%22username%22%3A%22ivan_test%22%7D&" +
  "hash=2dae458d5431f46aca7623a1aaa122afb0727c704542dccadd759ddb5296eddf";

describe("verifyTelegramInitData", () => {
  it("accepts a validly signed payload when freshness is not a concern", async () => {
    const result = await verifyTelegramInitData(VALID_INIT_DATA, BOT_TOKEN, Number.MAX_SAFE_INTEGER);
    expect(result.valid).toBe(true);
    expect(result.user?.id).toBe(987654321);
    expect(result.user?.username).toBe("ivan_test");
  });

  it("rejects the same payload as expired under the default max age", async () => {
    const result = await verifyTelegramInitData(VALID_INIT_DATA, BOT_TOKEN);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects a tampered field", async () => {
    const tampered = VALID_INIT_DATA.replace("ivan_test", "mallory");
    const result = await verifyTelegramInitData(tampered, BOT_TOKEN, Number.MAX_SAFE_INTEGER);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  it("rejects a payload with no hash", async () => {
    const noHash = "auth_date=1700000000&query_id=x";
    const result = await verifyTelegramInitData(noHash, BOT_TOKEN);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing_hash");
  });
});
```

`supabase/functions/_shared/orderStateMachine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canStaffTransition, canGuestCancel } from "./orderStateMachine.ts";

describe("canStaffTransition", () => {
  it("allows new -> accepted", () => {
    expect(canStaffTransition("new", "accepted")).toBe(true);
  });
  it("rejects new -> preparing (must go through accepted first)", () => {
    expect(canStaffTransition("new", "preparing")).toBe(false);
  });
  it("rejects any transition out of a terminal state", () => {
    expect(canStaffTransition("handed_out", "preparing")).toBe(false);
    expect(canStaffTransition("cancelled_by_guest", "accepted")).toBe(false);
  });
  it("allows recovering a problem order back into the flow", () => {
    expect(canStaffTransition("problem", "accepted")).toBe(true);
  });
});

describe("canGuestCancel", () => {
  it("allows cancellation while new", () => {
    expect(canGuestCancel("new")).toBe(true);
  });
  it("rejects cancellation once preparing", () => {
    expect(canGuestCancel("preparing")).toBe(false);
  });
  it("respects a custom cancellable-status list", () => {
    expect(canGuestCancel("preparing", ["new", "preparing"])).toBe(true);
  });
});
```

`supabase/functions/_shared/timeWindow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isWithinSchedule, validateRequestedTime, type WeeklySchedule } from "./timeWindow.ts";

// 2026-08-31T10:00:00Z is a Monday in UTC.
const MONDAY_10AM = new Date("2026-08-31T10:00:00Z");
const SCHEDULE: WeeklySchedule = {
  mon: { open: "08:00", close: "20:00" },
};

describe("isWithinSchedule", () => {
  it("is true during open hours", () => {
    expect(isWithinSchedule(MONDAY_10AM, SCHEDULE, "UTC")).toBe(true);
  });
  it("is false before opening", () => {
    expect(isWithinSchedule(new Date("2026-08-31T05:00:00Z"), SCHEDULE, "UTC")).toBe(false);
  });
  it("is false after closing", () => {
    expect(isWithinSchedule(new Date("2026-08-31T21:00:00Z"), SCHEDULE, "UTC")).toBe(false);
  });
  it("is false on a day with no schedule entry", () => {
    expect(isWithinSchedule(new Date("2026-09-01T10:00:00Z"), SCHEDULE, "UTC")).toBe(false); // Tuesday
  });
});

describe("validateRequestedTime", () => {
  it("accepts ASAP during open hours", () => {
    const result = validateRequestedTime("asap", null, MONDAY_10AM, SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(true);
  });
  it("rejects ASAP outside open hours", () => {
    const result = validateRequestedTime("asap", null, new Date("2026-08-31T21:00:00Z"), SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("location_closed");
  });
  it("rejects a scheduled time sooner than the prep time", () => {
    const requested = new Date(MONDAY_10AM.getTime() + 5 * 60000); // only 5 min ahead
    const result = validateRequestedTime("scheduled", requested, MONDAY_10AM, SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too_soon");
  });
  it("rejects a scheduled time outside working hours", () => {
    const requested = new Date("2026-08-31T21:00:00Z");
    const result = validateRequestedTime("scheduled", requested, MONDAY_10AM, SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("outside_hours");
  });
  it("accepts a valid scheduled time", () => {
    const requested = new Date(MONDAY_10AM.getTime() + 30 * 60000);
    const result = validateRequestedTime("scheduled", requested, MONDAY_10AM, SCHEDULE, "UTC", 15);
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `telegramAuth.ts`, `orderStateMachine.ts`, `timeWindow.ts` don't exist yet.

- [ ] **Step 3: Implement `telegramAuth.ts`**

```ts
export interface TelegramInitDataResult {
  valid: boolean;
  reason?: "missing_hash" | "bad_signature" | "expired" | "bad_user_payload";
  data?: Record<string, string>;
  user?: { id: number; first_name?: string; username?: string };
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400
): Promise<TelegramInitDataResult> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { valid: false, reason: "missing_hash" };
  params.delete("hash");

  const data: Record<string, string> = {};
  const pairs: string[] = [];
  for (const key of Array.from(params.keys()).sort()) {
    const value = params.get(key)!;
    data[key] = value;
    pairs.push(`${key}=${value}`);
  }
  const dataCheckString = pairs.join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const computedHex = toHex(await hmacSha256(secretKey, dataCheckString));

  if (computedHex !== hash) {
    return { valid: false, reason: "bad_signature" };
  }

  const authDate = Number(data["auth_date"]);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    return { valid: false, reason: "expired" };
  }

  let user: TelegramInitDataResult["user"];
  if (data["user"]) {
    try {
      const parsed = JSON.parse(data["user"]);
      user = { id: parsed.id, first_name: parsed.first_name, username: parsed.username };
    } catch {
      return { valid: false, reason: "bad_user_payload" };
    }
  }

  return { valid: true, data, user };
}
```

- [ ] **Step 4: Implement `orderStateMachine.ts`**

```ts
export type OrderStatus =
  | "new"
  | "waiting_confirmation"
  | "accepted"
  | "preparing"
  | "ready"
  | "handed_out"
  | "cancelled_by_guest"
  | "cancelled_by_establishment"
  | "expired"
  | "problem";

const STAFF_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["accepted", "cancelled_by_establishment", "problem"],
  waiting_confirmation: ["accepted", "cancelled_by_establishment", "problem"],
  accepted: ["preparing", "cancelled_by_establishment", "problem"],
  preparing: ["ready", "problem"],
  ready: ["handed_out", "problem"],
  handed_out: [],
  cancelled_by_guest: [],
  cancelled_by_establishment: [],
  expired: [],
  problem: ["accepted", "preparing", "cancelled_by_establishment"],
};

const DEFAULT_GUEST_CANCELLABLE: OrderStatus[] = ["new", "waiting_confirmation", "accepted"];

export function canStaffTransition(from: OrderStatus, to: OrderStatus): boolean {
  return STAFF_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canGuestCancel(
  status: OrderStatus,
  cancellableStatuses: OrderStatus[] = DEFAULT_GUEST_CANCELLABLE
): boolean {
  return cancellableStatuses.includes(status);
}
```

- [ ] **Step 5: Implement `timeWindow.ts`**

```ts
export interface DaySchedule {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
  closed?: boolean;
}

export type WeeklySchedule = Partial<
  Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", DaySchedule>
>;

const WEEKDAY_MAP: Record<string, keyof WeeklySchedule> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

function localParts(at: Date, timezone: string): { weekday: keyof WeeklySchedule; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const weekdayShort = parts.find((p) => p.type === "weekday")!.value;
  let hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  if (hour === 24) hour = 0;
  return { weekday: WEEKDAY_MAP[weekdayShort], minutes: hour * 60 + minute };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinSchedule(at: Date, schedule: WeeklySchedule, timezone: string): boolean {
  const { weekday, minutes } = localParts(at, timezone);
  const day = schedule[weekday];
  if (!day || day.closed) return false;
  return minutes >= toMinutes(day.open) && minutes <= toMinutes(day.close);
}

export interface RequestedTimeCheck {
  ok: boolean;
  reason?: "location_closed" | "too_soon" | "outside_hours";
}

export function validateRequestedTime(
  mode: "asap" | "scheduled",
  requestedAt: Date | null,
  now: Date,
  schedule: WeeklySchedule,
  timezone: string,
  prepTimeMinutes: number
): RequestedTimeCheck {
  if (!isWithinSchedule(now, schedule, timezone)) {
    return { ok: false, reason: "location_closed" };
  }
  if (mode === "asap") return { ok: true };

  if (!requestedAt || !isWithinSchedule(requestedAt, schedule, timezone)) {
    return { ok: false, reason: "outside_hours" };
  }
  const minAllowed = new Date(now.getTime() + prepTimeMinutes * 60000);
  if (requestedAt < minAllowed) {
    return { ok: false, reason: "too_soon" };
  }
  return { ok: true };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — all tests in the three new files green.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "feat: shared Telegram auth, order state machine, and time-window logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Edge Function `get-menu`

**Files:**
- Create: `supabase/functions/get-menu/logic.ts`
- Create: `supabase/functions/get-menu/logic.test.ts`
- Create: `supabase/functions/get-menu/index.ts`

**Interfaces:**
- Consumes: nothing from other tasks directly (pure function; `index.ts`
  queries `locations`, `categories`, `products`, `product_location_overrides`,
  `stop_list` at runtime).
- Produces: `buildMenu(categories, products, stops, now): {categories, products}`;
  deployed function `GET /functions/v1/get-menu?location_id=<uuid>`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/get-menu/logic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildMenu, type CategoryRow, type ProductRow, type StopRow } from "./logic.ts";

const NOW = new Date("2026-08-31T10:00:00Z");

const CATEGORIES: CategoryRow[] = [
  { id: "cat-2", name: "Bakery", icon: null, sort_order: 2 },
  { id: "cat-1", name: "Coffee", icon: null, sort_order: 1 },
];

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "prod-1",
    category_id: "cat-1",
    name: "Cappuccino",
    description: "Classic",
    base_price: 280,
    image_url: null,
    calories: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
    ingredients: null,
    allergens: [],
    badges: [],
    location_override: null,
    ...overrides,
  };
}

describe("buildMenu", () => {
  it("sorts categories by sort_order", () => {
    const result = buildMenu(CATEGORIES, [], [], NOW);
    expect(result.categories.map((c) => c.id)).toEqual(["cat-1", "cat-2"]);
  });

  it("excludes a product with an active product-level stop", () => {
    const stops: StopRow[] = [
      { scope_type: "product", scope_id: "prod-1", stopped_until: null, stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = buildMenu(CATEGORIES, [product()], stops, NOW);
    expect(result.products).toHaveLength(0);
  });

  it("excludes a product whose category is stopped", () => {
    const stops: StopRow[] = [
      { scope_type: "category", scope_id: "cat-1", stopped_until: null, stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = buildMenu(CATEGORIES, [product()], stops, NOW);
    expect(result.products).toHaveLength(0);
  });

  it("includes a product whose stop has already expired (stopped_until in the past)", () => {
    const stops: StopRow[] = [
      { scope_type: "product", scope_id: "prod-1", stopped_until: "2026-08-30T00:00:00Z", stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = buildMenu(CATEGORIES, [product()], stops, NOW);
    expect(result.products).toHaveLength(1);
  });

  it("stopped_for_today only applies on the day it was created", () => {
    const stops: StopRow[] = [
      { scope_type: "product", scope_id: "prod-1", stopped_until: null, stopped_for_today: true, created_at: "2026-08-30T09:00:00Z" },
    ];
    const result = buildMenu(CATEGORIES, [product()], stops, NOW); // NOW is the next day
    expect(result.products).toHaveLength(1);
  });

  it("applies a location price override", () => {
    const p = product({ location_override: { price_override: 250, is_available: true, is_published: true } });
    const result = buildMenu(CATEGORIES, [p], [], NOW);
    expect(result.products[0].price).toBe(250);
  });

  it("excludes a product marked unavailable at this location", () => {
    const p = product({ location_override: { price_override: null, is_available: false, is_published: true } });
    const result = buildMenu(CATEGORIES, [p], [], NOW);
    expect(result.products).toHaveLength(0);
  });

  it("excludes a product marked unpublished at this location", () => {
    const p = product({ location_override: { price_override: null, is_available: true, is_published: false } });
    const result = buildMenu(CATEGORIES, [p], [], NOW);
    expect(result.products).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/get-menu`
Expected: FAIL — `./logic.ts` doesn't exist.

- [ ] **Step 3: Implement `logic.ts`**

```ts
export interface CategoryRow {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
}

export interface ProductRow {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  base_price: number;
  image_url: string | null;
  calories: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  ingredients: string | null;
  allergens: string[];
  badges: string[];
  location_override: { price_override: number | null; is_available: boolean; is_published: boolean } | null;
}

export interface StopRow {
  scope_type: "product" | "modifier" | "category" | "collection";
  scope_id: string;
  stopped_until: string | null;
  stopped_for_today: boolean;
  created_at: string;
}

export interface MenuProduct {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  calories: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  ingredients: string | null;
  allergens: string[];
  badges: string[];
}

export function isStopActive(
  stop: Pick<StopRow, "stopped_until" | "stopped_for_today" | "created_at">,
  now: Date
): boolean {
  if (stop.stopped_for_today) {
    const created = new Date(stop.created_at);
    return (
      created.getUTCFullYear() === now.getUTCFullYear() &&
      created.getUTCMonth() === now.getUTCMonth() &&
      created.getUTCDate() === now.getUTCDate()
    );
  }
  if (stop.stopped_until) return new Date(stop.stopped_until) > now;
  return true;
}

export function buildMenu(
  categories: CategoryRow[],
  products: ProductRow[],
  stops: StopRow[],
  now: Date
): { categories: CategoryRow[]; products: MenuProduct[] } {
  const activeStops = stops.filter((s) => isStopActive(s, now));
  const stoppedProductIds = new Set(activeStops.filter((s) => s.scope_type === "product").map((s) => s.scope_id));
  const stoppedCategoryIds = new Set(activeStops.filter((s) => s.scope_type === "category").map((s) => s.scope_id));

  const products_ = products
    .filter((p) => !stoppedProductIds.has(p.id))
    .filter((p) => !p.category_id || !stoppedCategoryIds.has(p.category_id))
    .filter((p) => p.location_override?.is_available !== false)
    .filter((p) => p.location_override?.is_published !== false)
    .map<MenuProduct>((p) => ({
      id: p.id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      price: p.location_override?.price_override ?? p.base_price,
      image_url: p.image_url,
      calories: p.calories,
      protein_g: p.protein_g,
      fat_g: p.fat_g,
      carbs_g: p.carbs_g,
      ingredients: p.ingredients,
      allergens: p.allergens,
      badges: p.badges,
    }));

  return {
    categories: [...categories].sort((a, b) => a.sort_order - b.sort_order),
    products: products_,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/get-menu`
Expected: PASS.

- [ ] **Step 5: Implement `index.ts`**

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildMenu, type ProductRow, type StopRow } from "./logic.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const locationId = url.searchParams.get("location_id");
  if (!locationId) return json({ error: "location_id_required" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: location, error: locError } = await db
    .from("locations")
    .select("id, business_id, status")
    .eq("id", locationId)
    .maybeSingle();
  if (locError) return json({ error: "db_error" }, 500);
  if (!location || location.status !== "active") return json({ error: "location_not_found" }, 404);

  const [{ data: categories }, { data: products }, { data: stops }] = await Promise.all([
    db.from("categories").select("id, name, icon, sort_order").eq("business_id", location.business_id).eq("status", "active"),
    db
      .from("products")
      .select(
        "id, category_id, name, description, base_price, image_url, calories, protein_g, fat_g, carbs_g, ingredients, allergens, badges, product_location_overrides!left(location_id, price_override, is_available, is_published)"
      )
      .eq("business_id", location.business_id)
      .eq("status", "published"),
    db
      .from("stop_list")
      .select("scope_type, scope_id, stopped_until, stopped_for_today, created_at")
      .eq("business_id", location.business_id)
      .or(`location_id.is.null,location_id.eq.${locationId}`)
      .is("lifted_at", null),
  ]);

  const productRows: ProductRow[] = (products ?? []).map((p: any) => ({
    ...p,
    location_override:
      (p.product_location_overrides ?? []).find((o: any) => o.location_id === locationId) ?? null,
  }));

  const menu = buildMenu(categories ?? [], productRows, (stops ?? []) as StopRow[], new Date());
  return json(menu);
});
```

- [ ] **Step 6: Deploy the function**

Use the Supabase MCP tool `deploy_edge_function` with:
- `project_id`: `rlxbhbdcecrnykwxnqtx`
- `name`: `get-menu`
- `entrypoint_path`: `index.ts`
- `verify_jwt`: `false` (guests have no Supabase session; this endpoint only
  reads published data)
- `files`: `index.ts` and `logic.ts` (contents from Steps 3 and 5)

- [ ] **Step 7: Smoke-test the deployed function**

Get the project URL via the Supabase MCP tool `get_project_url`
(`project_id` `rlxbhbdcecrnykwxnqtx`). Seed one real business/location/
product via `execute_sql` (same pattern as Task 2 Step 3, but leave the rows
in place this time and note the returned `location_id`), then:

```bash
curl -s "https://rlxbhbdcecrnykwxnqtx.supabase.co/functions/v1/get-menu?location_id=<location_id>"
```

Expected: JSON with the seeded category and product. Then delete the seed
business via `execute_sql` as in Task 2 Step 4.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/get-menu/
git commit -m "feat: get-menu edge function

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Edge Function `create-order`

**Files:**
- Create: `supabase/functions/create-order/logic.ts`
- Create: `supabase/functions/create-order/logic.test.ts`
- Create: `supabase/functions/create-order/index.ts`

**Interfaces:**
- Consumes: `verifyTelegramInitData` (Task 10), `validateRequestedTime`/`WeeklySchedule` (Task 10).
- Produces: `validateAndPriceOrder(items, products, modifiers, stops, now): OrderValidationResult`;
  deployed function `POST /functions/v1/create-order`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/create-order/logic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateAndPriceOrder,
  type CartItemInput,
  type ProductCatalogEntry,
  type ModifierCatalogEntry,
  type StopEntry,
} from "./logic.ts";

const NOW = new Date("2026-08-31T10:00:00Z");

function products(...entries: Partial<ProductCatalogEntry>[]): Map<string, ProductCatalogEntry> {
  const map = new Map<string, ProductCatalogEntry>();
  for (const e of entries) {
    const full: ProductCatalogEntry = {
      id: "prod-1",
      name: "Cappuccino",
      base_price: 280,
      status: "published",
      location_override: null,
      ...e,
    };
    map.set(full.id, full);
  }
  return map;
}

describe("validateAndPriceOrder", () => {
  it("rejects an empty cart", () => {
    const result = validateAndPriceOrder([], products(), new Map(), [], NOW);
    expect(result).toEqual({ ok: false, reason: "empty_cart" });
  });

  it("rejects an unknown product", () => {
    const items: CartItemInput[] = [{ product_id: "missing", quantity: 1, modifier_ids: [] }];
    const result = validateAndPriceOrder(items, products(), new Map(), [], NOW);
    expect(result).toEqual({ ok: false, reason: "product_not_found", product_id: "missing" });
  });

  it("rejects a draft (unpublished) product", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: [] }];
    const result = validateAndPriceOrder(items, products({ status: "draft" }), new Map(), [], NOW);
    expect(result).toEqual({ ok: false, reason: "product_not_found", product_id: "prod-1" });
  });

  it("rejects a product unavailable at this location", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: [] }];
    const p = products({ location_override: { price_override: null, is_available: false, is_published: true } });
    const result = validateAndPriceOrder(items, p, new Map(), [], NOW);
    expect(result).toEqual({ ok: false, reason: "product_unavailable", product_id: "prod-1" });
  });

  it("rejects a product with an active stop", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: [] }];
    const stops: StopEntry[] = [
      { scope_type: "product", scope_id: "prod-1", stopped_until: null, stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = validateAndPriceOrder(items, products(), new Map(), stops, NOW);
    expect(result).toEqual({ ok: false, reason: "product_unavailable", product_id: "prod-1" });
  });

  it("rejects a stopped modifier", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 1, modifier_ids: ["mod-1"] }];
    const modifiers = new Map<string, ModifierCatalogEntry>([
      ["mod-1", { id: "mod-1", group_id: "g1", name: "Oat milk", price_delta: 80 }],
    ]);
    const stops: StopEntry[] = [
      { scope_type: "modifier", scope_id: "mod-1", stopped_until: null, stopped_for_today: false, created_at: NOW.toISOString() },
    ];
    const result = validateAndPriceOrder(items, products(), modifiers, stops, NOW);
    expect(result).toEqual({ ok: false, reason: "product_unavailable", product_id: "prod-1" });
  });

  it("rejects a non-positive or non-integer quantity", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 0, modifier_ids: [] }];
    const result = validateAndPriceOrder(items, products(), new Map(), [], NOW);
    expect(result).toEqual({ ok: false, reason: "invalid_quantity", product_id: "prod-1" });
  });

  it("prices a cart with a location override and a modifier, across quantity", () => {
    const items: CartItemInput[] = [{ product_id: "prod-1", quantity: 2, modifier_ids: ["mod-1"] }];
    const p = products({ location_override: { price_override: 250, is_available: true, is_published: true } });
    const modifiers = new Map<string, ModifierCatalogEntry>([
      ["mod-1", { id: "mod-1", group_id: "g1", name: "Oat milk", price_delta: 80 }],
    ]);
    const result = validateAndPriceOrder(items, p, modifiers, [], NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // (250 override + 80 modifier) * 2 = 660
      expect(result.items[0].unit_price_snapshot).toBe(330);
      expect(result.items[0].line_total).toBe(660);
      expect(result.subtotal).toBe(660);
      expect(result.total).toBe(660);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/create-order`
Expected: FAIL — `./logic.ts` doesn't exist.

- [ ] **Step 3: Implement `logic.ts`**

```ts
export interface CartItemInput {
  product_id: string;
  quantity: number;
  modifier_ids: string[];
}

export interface ProductCatalogEntry {
  id: string;
  name: string;
  base_price: number;
  status: "draft" | "published" | "archived";
  location_override: { price_override: number | null; is_available: boolean; is_published: boolean } | null;
}

export interface ModifierCatalogEntry {
  id: string;
  group_id: string;
  name: string;
  price_delta: number;
}

export interface StopEntry {
  scope_type: "product" | "modifier" | "category" | "collection";
  scope_id: string;
  stopped_until: string | null;
  stopped_for_today: boolean;
  created_at: string;
}

export interface PricedItem {
  product_id: string;
  product_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  modifiers_snapshot: { id: string; name: string; price_delta: number }[];
  line_total: number;
}

export type OrderValidationResult =
  | { ok: true; items: PricedItem[]; subtotal: number; total: number }
  | {
      ok: false;
      reason: "empty_cart" | "product_unavailable" | "product_not_found" | "invalid_quantity";
      product_id?: string;
    };

function isStopActive(
  stop: Pick<StopEntry, "stopped_until" | "stopped_for_today" | "created_at">,
  now: Date
): boolean {
  if (stop.stopped_for_today) {
    const created = new Date(stop.created_at);
    return (
      created.getUTCFullYear() === now.getUTCFullYear() &&
      created.getUTCMonth() === now.getUTCMonth() &&
      created.getUTCDate() === now.getUTCDate()
    );
  }
  if (stop.stopped_until) return new Date(stop.stopped_until) > now;
  return true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function validateAndPriceOrder(
  items: CartItemInput[],
  products: Map<string, ProductCatalogEntry>,
  modifiers: Map<string, ModifierCatalogEntry>,
  stops: StopEntry[],
  now: Date
): OrderValidationResult {
  if (items.length === 0) return { ok: false, reason: "empty_cart" };

  const activeStops = stops.filter((s) => isStopActive(s, now));
  const stoppedProductIds = new Set(activeStops.filter((s) => s.scope_type === "product").map((s) => s.scope_id));
  const stoppedModifierIds = new Set(activeStops.filter((s) => s.scope_type === "modifier").map((s) => s.scope_id));

  const priced: PricedItem[] = [];

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, reason: "invalid_quantity", product_id: item.product_id };
    }

    const product = products.get(item.product_id);
    if (!product || product.status !== "published") {
      return { ok: false, reason: "product_not_found", product_id: item.product_id };
    }

    const override = product.location_override;
    const available = override ? override.is_available && override.is_published : true;
    if (!available || stoppedProductIds.has(product.id)) {
      return { ok: false, reason: "product_unavailable", product_id: item.product_id };
    }
    if (item.modifier_ids.some((id) => stoppedModifierIds.has(id))) {
      return { ok: false, reason: "product_unavailable", product_id: item.product_id };
    }

    const basePrice = override?.price_override ?? product.base_price;
    const selectedModifiers = item.modifier_ids.map((id) => {
      const m = modifiers.get(id);
      return m ? { id: m.id, name: m.name, price_delta: m.price_delta } : { id, name: "unknown", price_delta: 0 };
    });
    const modifiersTotal = selectedModifiers.reduce((sum, m) => sum + m.price_delta, 0);
    const unitPrice = round2(basePrice + modifiersTotal);
    const lineTotal = round2(unitPrice * item.quantity);

    priced.push({
      product_id: product.id,
      product_name_snapshot: product.name,
      unit_price_snapshot: unitPrice,
      quantity: item.quantity,
      modifiers_snapshot: selectedModifiers,
      line_total: lineTotal,
    });
  }

  const subtotal = round2(priced.reduce((sum, i) => sum + i.line_total, 0));
  return { ok: true, items: priced, subtotal, total: subtotal };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/create-order`
Expected: PASS.

- [ ] **Step 5: Implement `index.ts`**

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyTelegramInitData } from "../_shared/telegramAuth.ts";
import { validateRequestedTime, type WeeklySchedule } from "../_shared/timeWindow.ts";
import {
  validateAndPriceOrder,
  type CartItemInput,
  type ProductCatalogEntry,
  type ModifierCatalogEntry,
  type StopEntry,
} from "./logic.ts";

interface CreateOrderBody {
  init_data: string;
  location_id: string;
  table_id?: string | null;
  order_type: "dine_in" | "takeaway";
  requested_time_mode: "asap" | "scheduled";
  requested_time?: string | null;
  comment?: string | null;
  idempotency_key: string;
  items: CartItemInput[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const auth = await verifyTelegramInitData(body.init_data, Deno.env.get("TELEGRAM_BOT_TOKEN")!);
  if (!auth.valid || !auth.user) return json({ error: "unauthorized", reason: auth.reason }, 401);

  if (!body.location_id || !body.order_type || !body.idempotency_key || !Array.isArray(body.items)) {
    return json({ error: "invalid_request" }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: existing } = await db
    .from("orders")
    .select("id, order_number, status, total")
    .eq("location_id", body.location_id)
    .eq("idempotency_key", body.idempotency_key)
    .maybeSingle();
  if (existing) return json({ order: existing }, 200);

  const { data: location } = await db
    .from("locations")
    .select("id, business_id, status, timezone, working_hours, default_prep_time_minutes")
    .eq("id", body.location_id)
    .maybeSingle();
  if (!location || location.status !== "active") return json({ error: "location_not_found" }, 404);

  const now = new Date();
  const timeCheck = validateRequestedTime(
    body.requested_time_mode,
    body.requested_time ? new Date(body.requested_time) : null,
    now,
    (location.working_hours ?? {}) as WeeklySchedule,
    location.timezone,
    location.default_prep_time_minutes
  );
  if (!timeCheck.ok) return json({ error: "invalid_time", reason: timeCheck.reason }, 422);

  const productIds = [...new Set(body.items.map((i) => i.product_id))];
  const { data: productRows } = await db
    .from("products")
    .select(
      "id, name, base_price, status, business_id, product_location_overrides!left(location_id, price_override, is_available, is_published)"
    )
    .in("id", productIds);

  const productMap = new Map<string, ProductCatalogEntry>();
  for (const p of productRows ?? []) {
    if (p.business_id !== location.business_id) continue;
    const override = (p.product_location_overrides ?? []).find((o: any) => o.location_id === body.location_id) ?? null;
    productMap.set(p.id, { id: p.id, name: p.name, base_price: p.base_price, status: p.status, location_override: override });
  }

  const modifierIds = [...new Set(body.items.flatMap((i) => i.modifier_ids ?? []))];
  const { data: modifierRows } = modifierIds.length
    ? await db.from("modifiers").select("id, modifier_group_id, name, price_delta").in("id", modifierIds)
    : { data: [] as any[] };
  const modifierMap = new Map<string, ModifierCatalogEntry>(
    (modifierRows ?? []).map((m: any) => [m.id, { id: m.id, group_id: m.modifier_group_id, name: m.name, price_delta: m.price_delta }])
  );

  const { data: stopRows } = await db
    .from("stop_list")
    .select("scope_type, scope_id, stopped_until, stopped_for_today, created_at")
    .eq("business_id", location.business_id)
    .or(`location_id.is.null,location_id.eq.${body.location_id}`)
    .is("lifted_at", null);

  const result = validateAndPriceOrder(
    body.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, modifier_ids: i.modifier_ids ?? [] })),
    productMap,
    modifierMap,
    (stopRows ?? []) as StopEntry[],
    now
  );
  if (!result.ok) return json({ error: result.reason, product_id: (result as any).product_id }, 422);

  await db.from("guests").upsert({
    telegram_user_id: auth.user.id,
    first_name: auth.user.first_name,
    username: auth.user.username,
    last_seen_at: now.toISOString(),
  });

  const { data: orderNumber } = await db.rpc("next_order_number", { p_location_id: body.location_id });

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      location_id: body.location_id,
      table_id: body.table_id ?? null,
      guest_telegram_user_id: auth.user.id,
      order_type: body.order_type,
      requested_time_mode: body.requested_time_mode,
      requested_time: body.requested_time ?? null,
      status: "new",
      comment: body.comment ?? null,
      subtotal: result.subtotal,
      total: result.total,
      order_number: orderNumber,
      idempotency_key: body.idempotency_key,
    })
    .select()
    .single();

  if (orderError || !order) {
    if ((orderError as any)?.code === "23505") {
      const { data: raceExisting } = await db
        .from("orders")
        .select("id, order_number, status, total")
        .eq("location_id", body.location_id)
        .eq("idempotency_key", body.idempotency_key)
        .maybeSingle();
      if (raceExisting) return json({ order: raceExisting }, 200);
    }
    return json({ error: "order_create_failed" }, 500);
  }

  await db.from("order_items").insert(
    result.items.map((i) => ({
      order_id: order.id,
      product_id: i.product_id,
      product_name_snapshot: i.product_name_snapshot,
      unit_price_snapshot: i.unit_price_snapshot,
      quantity: i.quantity,
      modifiers_snapshot: i.modifiers_snapshot,
      line_total: i.line_total,
    }))
  );

  await db.from("order_events").insert({
    order_id: order.id,
    event_type: "status_change",
    from_status: null,
    to_status: "new",
    actor_type: "guest",
    actor_id: String(auth.user.id),
  });

  return json({ order }, 201);
});
```

- [ ] **Step 6: Deploy the function**

Use `deploy_edge_function` — `project_id` `rlxbhbdcecrnykwxnqtx`, `name`
`create-order`, `entrypoint_path` `index.ts`, `verify_jwt` `false` (guests
authenticate via Telegram `initData`, not a Supabase session), `files`:
`index.ts`, `logic.ts`, and the three `_shared/*.ts` files it imports
(`telegramAuth.ts`, `timeWindow.ts`) — note `import_map_path` is not needed
since imports use full `https://esm.sh/...` and relative `../_shared/...`
paths directly.

- [ ] **Step 7: Note the manual secret-configuration step**

`create-order` reads `Deno.env.get("TELEGRAM_BOT_TOKEN")`. Until sub-project
2 (the real Telegram bot) exists, set a placeholder so the function doesn't
crash: in the Supabase Dashboard → Project Settings → Edge Functions →
Secrets, add `TELEGRAM_BOT_TOKEN` = `placeholder-until-bot-exists`. Replace
it with the real bot token when sub-project 2 begins. (This step requires
dashboard access — it cannot be done via the MCP tools available in this
environment.)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/create-order/
git commit -m "feat: create-order edge function with server-side pricing and idempotency

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Edge Function `update-order-status`

**Files:**
- Create: `supabase/functions/update-order-status/index.ts`

**Interfaces:**
- Consumes: `canStaffTransition`, `type OrderStatus` (Task 10).
- Produces: deployed function `POST /functions/v1/update-order-status`
  (requires a staff/operator Supabase Auth session).

- [ ] **Step 1: Implement `index.ts`**

There's no separate `logic.ts` here — the only decision logic
(`canStaffTransition`) is already unit-tested in Task 10; this task's
correctness (the race-condition guard) is a database property, verified in
Step 3 below rather than with a Vitest mock.

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canStaffTransition, type OrderStatus } from "../_shared/orderStateMachine.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  // Validate the caller's Supabase session with the anon key + forwarded
  // Authorization header (so auth.getUser() enforces the JWT properly).
  const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  // Do the actual DB work with the service role: this function performs its
  // own authorization checks below rather than relying on RLS.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: profile } = await db.from("profiles").select("role, location_id").eq("id", userData.user.id).maybeSingle();
  if (!profile || !["staff", "fasdely_operator", "fasdely_admin"].includes(profile.role)) {
    return json({ error: "forbidden" }, 403);
  }

  let body: { order_id: string; to_status: OrderStatus };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.order_id || !body.to_status) return json({ error: "invalid_request" }, 400);

  const { data: order } = await db.from("orders").select("id, location_id, status").eq("id", body.order_id).maybeSingle();
  if (!order) return json({ error: "order_not_found" }, 404);

  if (profile.role === "staff" && order.location_id !== profile.location_id) {
    return json({ error: "forbidden" }, 403);
  }

  if (!canStaffTransition(order.status as OrderStatus, body.to_status)) {
    return json({ error: "invalid_transition", from: order.status, to: body.to_status }, 422);
  }

  // Conditional UPDATE: only succeeds if status still matches what we just
  // read, so a second concurrent request for the same order becomes a no-op
  // instead of double-processing it.
  const { data: updated, error: updateError } = await db
    .from("orders")
    .update({ status: body.to_status })
    .eq("id", order.id)
    .eq("status", order.status)
    .select()
    .maybeSingle();

  if (updateError) return json({ error: "update_failed" }, 500);
  if (!updated) return json({ error: "already_handled" }, 409);

  await db.from("order_events").insert({
    order_id: order.id,
    event_type: "status_change",
    from_status: order.status,
    to_status: body.to_status,
    actor_type: "staff",
    actor_id: userData.user.id,
  });

  return json({ order: updated });
});
```

- [ ] **Step 2: Deploy the function**

Use `deploy_edge_function` — `project_id` `rlxbhbdcecrnykwxnqtx`, `name`
`update-order-status`, `entrypoint_path` `index.ts`, `verify_jwt` `true`
(staff must be signed in via Supabase Auth), `files`: `index.ts` and the
`_shared/orderStateMachine.ts` file it imports.

- [ ] **Step 3: Verify the race-condition guard directly in SQL**

The Edge Function's guard is the conditional `UPDATE ... WHERE status =
<expected>`. Confirm that exact SQL pattern behaves as intended by
simulating two concurrent status-change attempts against the same row via
`execute_sql`:

```sql
with b as (
  insert into businesses (name) values ('__race_smoke_test__') returning id
), l as (
  insert into locations (business_id, name) select id, 'loc' from b returning id
), o as (
  insert into orders (location_id, guest_telegram_user_id, order_type, status, order_number, idempotency_key)
  select id, 1, 'takeaway', 'accepted', 1, 'race-smoke-1' from l returning id
)
select id from o;
```

Note the returned order id, then run two updates using the *same* expected
`status = 'accepted'` (simulating two staff members who both read
`'accepted'` before either wrote):

```sql
update orders set status = 'preparing' where id = '<order id>' and status = 'accepted' returning id;
-- second attempt, same expected prior status:
update orders set status = 'problem' where id = '<order id>' and status = 'accepted' returning id;
```

Expected: the first `update` returns one row; the second `update` returns
zero rows (because the row's status is now `'preparing'`, not `'accepted'`)
— exactly the "already handled" outcome the Edge Function returns as a 409.

Clean up: `delete from businesses where name = '__race_smoke_test__';`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/update-order-status/
git commit -m "feat: update-order-status edge function with staff state-machine guard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: Edge Function `cancel-order`

**Files:**
- Create: `supabase/functions/cancel-order/logic.ts`
- Create: `supabase/functions/cancel-order/logic.test.ts`
- Create: `supabase/functions/cancel-order/index.ts`

**Interfaces:**
- Consumes: `canGuestCancel`, `type OrderStatus` (Task 10);
  `verifyTelegramInitData` (Task 10).
- Produces: `checkCancelAllowed(input): {ok: true} | {ok: false; reason: 'forbidden'|'not_cancellable'}`;
  deployed function `POST /functions/v1/cancel-order`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/cancel-order/logic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkCancelAllowed } from "./logic.ts";

describe("checkCancelAllowed", () => {
  const base = {
    order_status: "new" as const,
    order_guest_telegram_user_id: 111,
    requesting_telegram_user_id: 111,
    cancellable_statuses: ["new", "waiting_confirmation", "accepted"] as const,
  };

  it("allows the owning guest to cancel a cancellable order", () => {
    expect(checkCancelAllowed({ ...base })).toEqual({ ok: true });
  });

  it("forbids a guest cancelling someone else's order", () => {
    const result = checkCancelAllowed({ ...base, requesting_telegram_user_id: 222 });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("checks ownership before checking cancellability", () => {
    // wrong guest AND a non-cancellable status: must still report "forbidden"
    const result = checkCancelAllowed({ ...base, requesting_telegram_user_id: 222, order_status: "preparing" as any });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("rejects cancelling an order that is already preparing", () => {
    const result = checkCancelAllowed({ ...base, order_status: "preparing" as any });
    expect(result).toEqual({ ok: false, reason: "not_cancellable" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/cancel-order`
Expected: FAIL — `./logic.ts` doesn't exist.

- [ ] **Step 3: Implement `logic.ts`**

```ts
import { canGuestCancel, type OrderStatus } from "../_shared/orderStateMachine.ts";

export interface CancelCheckInput {
  order_status: OrderStatus;
  order_guest_telegram_user_id: number;
  requesting_telegram_user_id: number;
  cancellable_statuses: OrderStatus[];
}

export type CancelCheckResult = { ok: true } | { ok: false; reason: "forbidden" | "not_cancellable" };

export function checkCancelAllowed(input: CancelCheckInput): CancelCheckResult {
  if (input.order_guest_telegram_user_id !== input.requesting_telegram_user_id) {
    return { ok: false, reason: "forbidden" };
  }
  if (!canGuestCancel(input.order_status, input.cancellable_statuses)) {
    return { ok: false, reason: "not_cancellable" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/cancel-order`
Expected: PASS.

- [ ] **Step 5: Implement `index.ts`**

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyTelegramInitData } from "../_shared/telegramAuth.ts";
import type { OrderStatus } from "../_shared/orderStateMachine.ts";
import { checkCancelAllowed } from "./logic.ts";

interface CancelBody {
  init_data: string;
  order_id: string;
  reason?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: CancelBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const auth = await verifyTelegramInitData(body.init_data, Deno.env.get("TELEGRAM_BOT_TOKEN")!);
  if (!auth.valid || !auth.user) return json({ error: "unauthorized", reason: auth.reason }, 401);
  if (!body.order_id) return json({ error: "invalid_request" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: order } = await db
    .from("orders")
    .select("id, status, guest_telegram_user_id")
    .eq("id", body.order_id)
    .maybeSingle();
  if (!order) return json({ error: "order_not_found" }, 404);

  const { data: settingRow } = await db.from("platform_settings").select("value").eq("key", "cancellable_statuses").maybeSingle();
  const cancellableStatuses = ((settingRow?.value as OrderStatus[]) ?? ["new", "waiting_confirmation", "accepted"]);

  const check = checkCancelAllowed({
    order_status: order.status as OrderStatus,
    order_guest_telegram_user_id: order.guest_telegram_user_id,
    requesting_telegram_user_id: auth.user.id,
    cancellable_statuses: cancellableStatuses,
  });
  if (!check.ok) return json({ error: check.reason }, check.reason === "forbidden" ? 403 : 422);

  const { data: updated, error: updateError } = await db
    .from("orders")
    .update({ status: "cancelled_by_guest" })
    .eq("id", order.id)
    .eq("status", order.status)
    .select()
    .maybeSingle();
  if (updateError) return json({ error: "update_failed" }, 500);
  if (!updated) return json({ error: "already_handled" }, 409);

  await db.from("order_events").insert({
    order_id: order.id,
    event_type: "cancellation",
    from_status: order.status,
    to_status: "cancelled_by_guest",
    actor_type: "guest",
    actor_id: String(auth.user.id),
    reason: body.reason ?? null,
  });

  return json({ order: updated });
});
```

- [ ] **Step 6: Deploy the function**

Use `deploy_edge_function` — `project_id` `rlxbhbdcecrnykwxnqtx`, `name`
`cancel-order`, `entrypoint_path` `index.ts`, `verify_jwt` `false` (guest
auth is via Telegram `initData`), `files`: `index.ts`, `logic.ts`, and
`../_shared/telegramAuth.ts` / `../_shared/orderStateMachine.ts`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/cancel-order/
git commit -m "feat: cancel-order edge function

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: Edge Function `telegram-webhook` (minimal `/start` handling)

**Files:**
- Create: `supabase/functions/telegram-webhook/logic.ts`
- Create: `supabase/functions/telegram-webhook/logic.test.ts`
- Create: `supabase/functions/telegram-webhook/index.ts`

**Interfaces:**
- Produces: `parseStartCommand(text): {command: 'start'; payload: string} | null`;
  `buildMiniAppDeepLink(botUsername, locationQrToken): string`; deployed
  function `POST /functions/v1/telegram-webhook`. Full bot conversational
  behavior is sub-project 2 — this task only resolves the QR deep-link so the
  Mini App opens to the right location, per the design spec's non-goals.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/telegram-webhook/logic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseStartCommand, buildMiniAppDeepLink } from "./logic.ts";

describe("parseStartCommand", () => {
  it("parses /start with a payload", () => {
    expect(parseStartCommand("/start abc123")).toEqual({ command: "start", payload: "abc123" });
  });
  it("parses /start with no payload", () => {
    expect(parseStartCommand("/start")).toEqual({ command: "start", payload: "" });
  });
  it("parses /start@BotUsername with a payload", () => {
    expect(parseStartCommand("/start@FasdelyBot xyz")).toEqual({ command: "start", payload: "xyz" });
  });
  it("returns null for unrelated text", () => {
    expect(parseStartCommand("hello there")).toBeNull();
  });
  it("returns null for undefined text", () => {
    expect(parseStartCommand(undefined)).toBeNull();
  });
});

describe("buildMiniAppDeepLink", () => {
  it("builds a t.me startapp link", () => {
    expect(buildMiniAppDeepLink("FasdelyBot", "abc 123")).toBe("https://t.me/FasdelyBot/app?startapp=abc%20123");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/telegram-webhook`
Expected: FAIL — `./logic.ts` doesn't exist.

- [ ] **Step 3: Implement `logic.ts`**

```ts
export interface ParsedStartCommand {
  command: "start";
  payload: string;
}

export function parseStartCommand(text: string | undefined): ParsedStartCommand | null {
  if (!text) return null;
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text.trim());
  if (!match) return null;
  return { command: "start", payload: match[1] ?? "" };
}

export function buildMiniAppDeepLink(botUsername: string, locationQrToken: string): string {
  return `https://t.me/${botUsername}/app?startapp=${encodeURIComponent(locationQrToken)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/telegram-webhook`
Expected: PASS.

- [ ] **Step 5: Implement `index.ts`**

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseStartCommand, buildMiniAppDeepLink } from "./logic.ts";

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json();
  const message = update.message;
  const parsed = parseStartCommand(message?.text);

  if (parsed && message?.chat?.id) {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME")!;
    let responseText = "Добро пожаловать в FASDELY! Откройте меню, чтобы сделать заказ.";

    if (parsed.payload) {
      const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: location } = await db
        .from("locations")
        .select("name, status")
        .eq("qr_token", parsed.payload)
        .maybeSingle();
      if (location && location.status === "active") {
        responseText = `Добро пожаловать в ${location.name}! Откройте меню, чтобы сделать заказ.`;
      }
    }

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: responseText,
        reply_markup: {
          inline_keyboard: [[{ text: "Открыть меню", web_app: { url: buildMiniAppDeepLink(botUsername, parsed.payload) } }]],
        },
      }),
    });
  }

  return new Response("ok", { status: 200 });
});
```

- [ ] **Step 6: Deploy the function**

Use `deploy_edge_function` — `project_id` `rlxbhbdcecrnykwxnqtx`, `name`
`telegram-webhook`, `entrypoint_path` `index.ts`, `verify_jwt` `false`
(Telegram calls this directly and authenticates via the
`X-Telegram-Bot-Api-Secret-Token` header instead), `files`: `index.ts` and
`logic.ts`.

- [ ] **Step 7: Note the manual secret-configuration and webhook-registration steps**

Requires dashboard access (outside the MCP tools available here), to be
done at the start of sub-project 2 once a real bot exists:
1. Set secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
   `TELEGRAM_WEBHOOK_SECRET` in Supabase Dashboard → Edge Functions →
   Secrets.
2. Register the webhook with Telegram: `POST
   https://api.telegram.org/bot<token>/setWebhook` with `url` = this
   function's URL and `secret_token` = the same `TELEGRAM_WEBHOOK_SECRET`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/telegram-webhook/
git commit -m "feat: telegram-webhook edge function (minimal /start deep-link resolution)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 16: Final security pass and sub-project handoff

**Files:**
- Modify: `README.md` (append a "Status" section)

**Interfaces:**
- Consumes: everything from Tasks 1-15.
- Produces: a documented, security-checked state ready for sub-projects 2-4
  to build on.

- [ ] **Step 1: Run the full test suite one more time**

Run: `npx vitest run`
Expected: PASS — every test file from Tasks 10-15 green.

- [ ] **Step 2: Run the Supabase security advisor**

Use the Supabase MCP tool `get_advisors` with `project_id`
`rlxbhbdcecrnykwxnqtx` and `type` `security`.

Expected: no advisories about tables with RLS disabled (every tenant-data
table was enabled across Tasks 5-9). If any advisory appears, fix it with a
new migration file (`0009_security_fixes.sql`) before continuing, and
include the remediation URL the advisor returns.

- [ ] **Step 3: Run the Supabase performance advisor**

Use `get_advisors` with `type` `performance`. Note any suggested indexes; add
them in a follow-up migration only if they cover a query this backend
actually issues (YAGNI — don't index speculatively).

- [ ] **Step 4: Confirm all 8 migrations are recorded on the remote project**

Use the Supabase MCP tool `list_migrations` with `project_id`
`rlxbhbdcecrnykwxnqtx`. Expected: 8 entries, one per file in
`supabase/migrations/`.

- [ ] **Step 5: Confirm all 5 Edge Functions are deployed**

Use the Supabase MCP tool `list_edge_functions` with `project_id`
`rlxbhbdcecrnykwxnqtx`. Expected: `get-menu`, `create-order`,
`update-order-status`, `cancel-order`, `telegram-webhook`, all `ACTIVE`.

- [ ] **Step 6: Append a status section to `README.md`**

```markdown

## Status

Backend Foundation (sub-project 1 of 5) complete: multi-tenant schema, RLS
tenant isolation, audit log, menu quality view, pg_cron jobs, and 5 Edge
Functions (get-menu, create-order, update-order-status, cancel-order,
telegram-webhook) are deployed to project `rlxbhbdcecrnykwxnqtx`.

Manual steps still required before guest ordering works end-to-end (see
Tasks 12 and 15 in `docs/superpowers/plans/2026-08-30-backend-foundation.md`):
set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and
`TELEGRAM_WEBHOOK_SECRET` as Edge Function secrets once a real Telegram bot
exists, and register the webhook with Telegram's `setWebhook` API.

Next: sub-project 2 (Telegram Bot + Guest Mini App).
```

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: mark backend foundation complete, note manual secret setup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
```
