-- Tenancy tables: restaurants, branches, memberships, audit_logs.

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and not private.is_reserved_slug(slug)),
  logo_url text check (char_length(logo_url) <= 1000),
  phone text check (char_length(phone) <= 30),
  whatsapp_number text check (char_length(whatsapp_number) <= 30),
  city text check (char_length(city) <= 60),
  timezone text not null default 'Asia/Karachi',
  currency text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  status public.restaurant_status not null default 'trial',
  trial_ends_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index restaurants_created_by_idx on public.restaurants (created_by);

create trigger restaurants_set_updated_at
  before update on public.restaurants
  for each row execute function private.set_updated_at();

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  address text check (char_length(address) <= 300),
  area text check (char_length(area) <= 80),
  city text check (char_length(city) <= 60),
  phone text check (char_length(phone) <= 30),
  is_open boolean not null default false,
  opening_hours jsonb check (private.is_valid_opening_hours(opening_hours)),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target for composite FKs so child rows can't point at another restaurant's branch.
  unique (id, restaurant_id)
);

create index branches_restaurant_id_idx on public.branches (restaurant_id);

create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function private.set_updated_at();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  -- null = access to all branches
  branch_id uuid,
  role public.member_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, restaurant_id),
  foreign key (branch_id, restaurant_id)
    references public.branches (id, restaurant_id)
    on delete set null (branch_id),
  constraint owner_has_all_branches check (role <> 'owner' or branch_id is null)
);

create index memberships_restaurant_id_idx on public.memberships (restaurant_id);
create index memberships_branch_id_idx on public.memberships (branch_id);
-- (user_id, restaurant_id) unique index also serves lookups by user_id.

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function private.set_updated_at();

create table public.audit_logs (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 3 and 80),
  entity_type text not null check (char_length(entity_type) between 1 and 60),
  entity_id text check (char_length(entity_id) <= 100),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_restaurant_created_idx on public.audit_logs (restaurant_id, created_at desc);
create index audit_logs_user_id_idx on public.audit_logs (user_id);
