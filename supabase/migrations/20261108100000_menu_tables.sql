-- Menu: categories, items, sizes (item_variants), extras (modifier groups/options),
-- per-branch settings and prices. Money is integer paisa.
-- Composite FKs (child.parent_id, child.restaurant_id) → parent(id, restaurant_id)
-- make cross-restaurant references impossible at the database level.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  name_ur text check (char_length(name_ur) <= 60),
  description text check (char_length(description) <= 300),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create index menu_categories_restaurant_idx on public.menu_categories (restaurant_id, sort_order);

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  name_ur text check (char_length(name_ur) <= 80),
  description text check (char_length(description) <= 500),
  description_ur text check (char_length(description_ur) <= 500),
  image_url text check (char_length(image_url) <= 1000),
  -- Used when the item has no sizes. Null is allowed only for sized items
  -- (the pricing engine rejects an unsized item without a price).
  base_price integer check (base_price between 0 and 100000000),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  tags text[] not null default '{}'
    check (tags <@ array['bestseller','spicy','new','vegetarian','deal','popular']::text[]),
  prep_time_minutes integer check (prep_time_minutes between 0 and 240),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 30),
  removable_options text[] not null default '{}' check (cardinality(removable_options) <= 30),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (category_id, restaurant_id)
    references public.menu_categories (id, restaurant_id) on delete cascade
);
create index menu_items_restaurant_idx on public.menu_items (restaurant_id);
create index menu_items_category_idx on public.menu_items (category_id, sort_order);

-- ---------------------------------------------------------------------------
-- Sizes ("item_variants" in the database; "Sizes" in the UI)
-- ---------------------------------------------------------------------------
create table public.item_variants (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  name_ur text check (char_length(name_ur) <= 40),
  -- Full price for this size (not a difference).
  price integer not null check (price between 0 and 100000000),
  is_default boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (item_id, restaurant_id)
    references public.menu_items (id, restaurant_id) on delete cascade
);
create index item_variants_item_idx on public.item_variants (item_id, sort_order);
create index item_variants_restaurant_idx on public.item_variants (restaurant_id);
create unique index item_variants_one_default
  on public.item_variants (item_id) where is_default and archived_at is null;

-- ---------------------------------------------------------------------------
-- Extras / Choices (reusable groups) and their options
-- ---------------------------------------------------------------------------
create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  name_ur text check (char_length(name_ur) <= 60),
  min_select integer not null default 0,
  max_select integer not null default 1,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  constraint modifier_groups_limits
    check (min_select >= 0 and max_select >= 1 and max_select >= min_select and max_select <= 50)
);
create index modifier_groups_restaurant_idx on public.modifier_groups (restaurant_id, sort_order);

create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  group_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  name_ur text check (char_length(name_ur) <= 60),
  -- Added to the item price. Can be 0 (e.g. spice level).
  price_delta integer not null default 0 check (price_delta between 0 and 100000000),
  is_default boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (group_id, restaurant_id)
    references public.modifier_groups (id, restaurant_id) on delete cascade
);
create index modifier_options_group_idx on public.modifier_options (group_id, sort_order);
create index modifier_options_restaurant_idx on public.modifier_options (restaurant_id);

create table public.item_modifier_groups (
  item_id uuid not null,
  group_id uuid not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (item_id, group_id),
  foreign key (item_id, restaurant_id)
    references public.menu_items (id, restaurant_id) on delete cascade,
  foreign key (group_id, restaurant_id)
    references public.modifier_groups (id, restaurant_id) on delete cascade
);
create index item_modifier_groups_group_idx on public.item_modifier_groups (group_id);
create index item_modifier_groups_restaurant_idx on public.item_modifier_groups (restaurant_id);

-- ---------------------------------------------------------------------------
-- Per-branch settings and prices
-- ---------------------------------------------------------------------------
create table public.branch_item_settings (
  branch_id uuid not null,
  item_id uuid not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  is_available boolean not null default true, -- in stock
  is_hidden boolean not null default false,   -- not sold at this branch
  price_override integer check (price_override between 0 and 100000000),
  updated_at timestamptz not null default now(),
  primary key (branch_id, item_id),
  foreign key (branch_id, restaurant_id)
    references public.branches (id, restaurant_id) on delete cascade,
  foreign key (item_id, restaurant_id)
    references public.menu_items (id, restaurant_id) on delete cascade
);
create index branch_item_settings_item_idx on public.branch_item_settings (item_id);
create index branch_item_settings_restaurant_idx on public.branch_item_settings (restaurant_id);

create table public.branch_variant_prices (
  branch_id uuid not null,
  variant_id uuid not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  price integer not null check (price between 0 and 100000000),
  updated_at timestamptz not null default now(),
  primary key (branch_id, variant_id),
  foreign key (branch_id, restaurant_id)
    references public.branches (id, restaurant_id) on delete cascade,
  foreign key (variant_id, restaurant_id)
    references public.item_variants (id, restaurant_id) on delete cascade
);
create index branch_variant_prices_variant_idx on public.branch_variant_prices (variant_id);
create index branch_variant_prices_restaurant_idx on public.branch_variant_prices (restaurant_id);

-- updated_at triggers
create trigger menu_categories_set_updated_at before update on public.menu_categories
  for each row execute function private.set_updated_at();
create trigger menu_items_set_updated_at before update on public.menu_items
  for each row execute function private.set_updated_at();
create trigger item_variants_set_updated_at before update on public.item_variants
  for each row execute function private.set_updated_at();
create trigger modifier_groups_set_updated_at before update on public.modifier_groups
  for each row execute function private.set_updated_at();
create trigger modifier_options_set_updated_at before update on public.modifier_options
  for each row execute function private.set_updated_at();
create trigger branch_item_settings_set_updated_at before update on public.branch_item_settings
  for each row execute function private.set_updated_at();
create trigger branch_variant_prices_set_updated_at before update on public.branch_variant_prices
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants: no anon access (public menu goes through get_public_menu()).
-- No DELETE on items/sizes/groups/options/categories: they are archived.
-- ---------------------------------------------------------------------------
revoke all on public.menu_categories, public.menu_items, public.item_variants,
  public.modifier_groups, public.modifier_options, public.item_modifier_groups,
  public.branch_item_settings, public.branch_variant_prices from anon, authenticated;
grant all on public.menu_categories, public.menu_items, public.item_variants,
  public.modifier_groups, public.modifier_options, public.item_modifier_groups,
  public.branch_item_settings, public.branch_variant_prices to service_role;

grant select on public.menu_categories, public.menu_items, public.item_variants,
  public.modifier_groups, public.modifier_options, public.item_modifier_groups,
  public.branch_item_settings, public.branch_variant_prices to authenticated;

grant insert (restaurant_id, name, name_ur, description, sort_order, is_active)
  on public.menu_categories to authenticated;
grant update (name, name_ur, description, sort_order, is_active, archived_at)
  on public.menu_categories to authenticated;

grant insert (restaurant_id, category_id, name, name_ur, description, description_ur, image_url,
  base_price, is_active, sort_order, tags, prep_time_minutes, aliases, removable_options)
  on public.menu_items to authenticated;
grant update (category_id, name, name_ur, description, description_ur, image_url, base_price,
  is_active, sort_order, tags, prep_time_minutes, aliases, removable_options, archived_at)
  on public.menu_items to authenticated;

grant insert (restaurant_id, item_id, name, name_ur, price, is_default, sort_order, is_active)
  on public.item_variants to authenticated;
grant update (name, name_ur, price, is_default, sort_order, is_active, archived_at)
  on public.item_variants to authenticated;

grant insert (restaurant_id, name, name_ur, min_select, max_select, sort_order)
  on public.modifier_groups to authenticated;
grant update (name, name_ur, min_select, max_select, sort_order, archived_at)
  on public.modifier_groups to authenticated;

grant insert (restaurant_id, group_id, name, name_ur, price_delta, is_default, is_available, sort_order)
  on public.modifier_options to authenticated;
grant update (name, name_ur, price_delta, is_default, is_available, sort_order, archived_at)
  on public.modifier_options to authenticated;

grant insert (item_id, group_id, restaurant_id, sort_order) on public.item_modifier_groups to authenticated;
grant update (sort_order) on public.item_modifier_groups to authenticated;
grant delete on public.item_modifier_groups to authenticated;

grant insert (branch_id, item_id, restaurant_id, is_available, is_hidden, price_override)
  on public.branch_item_settings to authenticated;
grant update (is_available, is_hidden, price_override) on public.branch_item_settings to authenticated;

grant insert (branch_id, variant_id, restaurant_id, price) on public.branch_variant_prices to authenticated;
grant update (price) on public.branch_variant_prices to authenticated;
grant delete on public.branch_variant_prices to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: members read; owner/manager write. Branch tables also need branch access.
-- Stock toggles for staff/kitchen go through set_item_stock() (next migration).
-- ---------------------------------------------------------------------------
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.item_variants enable row level security;
alter table public.modifier_groups enable row level security;
alter table public.modifier_options enable row level security;
alter table public.item_modifier_groups enable row level security;
alter table public.branch_item_settings enable row level security;
alter table public.branch_variant_prices enable row level security;

do $$
declare t text;
begin
  foreach t in array array['menu_categories','menu_items','item_variants',
    'modifier_groups','modifier_options','item_modifier_groups']
  loop
    execute format(
      'create policy "%1$s: members read" on public.%1$I for select to authenticated
         using (private.is_member(restaurant_id) or (select private.is_super_admin()))', t);
    execute format(
      'create policy "%1$s: owner/manager insert" on public.%1$I for insert to authenticated
         with check (private.has_role(restaurant_id, ''{owner,manager}''))', t);
    execute format(
      'create policy "%1$s: owner/manager update" on public.%1$I for update to authenticated
         using (private.has_role(restaurant_id, ''{owner,manager}''))
         with check (private.has_role(restaurant_id, ''{owner,manager}''))', t);
  end loop;

  foreach t in array array['branch_item_settings','branch_variant_prices']
  loop
    execute format(
      'create policy "%1$s: read accessible branches" on public.%1$I for select to authenticated
         using (private.can_access_branch(branch_id) or (select private.is_super_admin()))', t);
    execute format(
      'create policy "%1$s: owner/manager insert" on public.%1$I for insert to authenticated
         with check (private.has_role(restaurant_id, ''{owner,manager}'') and private.can_access_branch(branch_id))', t);
    execute format(
      'create policy "%1$s: owner/manager update" on public.%1$I for update to authenticated
         using (private.has_role(restaurant_id, ''{owner,manager}'') and private.can_access_branch(branch_id))
         with check (private.has_role(restaurant_id, ''{owner,manager}'') and private.can_access_branch(branch_id))', t);
  end loop;
end $$;

create policy "item_modifier_groups: owner/manager delete" on public.item_modifier_groups
  for delete to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}'));

create policy "branch_variant_prices: owner/manager delete" on public.branch_variant_prices
  for delete to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}') and private.can_access_branch(branch_id));
