-- Row Level Security: helper functions, column grants, policies.
-- Every helper is SECURITY DEFINER with an empty search_path, so it can read
-- memberships without recursing into memberships' own RLS.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create or replace function private.is_member(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.restaurant_id = p_restaurant_id
      and m.is_active
  );
$$;

create or replace function private.has_role(p_restaurant_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.restaurant_id = p_restaurant_id
      and m.is_active
      and m.role = any (p_roles)
  );
$$;

create or replace function private.has_restaurant_wide_access(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.restaurant_id = p_restaurant_id
      and m.is_active
      and m.branch_id is null
  );
$$;

create or replace function private.can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.branches b
    join public.memberships m on m.restaurant_id = b.restaurant_id
    where b.id = p_branch_id
      and m.user_id = (select auth.uid())
      and m.is_active
      and (m.branch_id is null or m.branch_id = b.id)
  );
$$;

create or replace function private.shares_restaurant(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships me
    join public.memberships them on them.restaurant_id = me.restaurant_id
    where me.user_id = (select auth.uid())
      and me.is_active
      and them.user_id = p_user_id
  );
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants. Column-level grants protect columns users must never write.
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.restaurants, public.branches,
  public.memberships, public.audit_logs from anon, authenticated;
grant all on public.profiles, public.restaurants, public.branches,
  public.memberships, public.audit_logs to service_role;

grant select on public.profiles to authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

grant select on public.restaurants to authenticated;
grant update (name, logo_url, phone, whatsapp_number, city) on public.restaurants to authenticated;

grant select on public.branches to authenticated;
grant insert (restaurant_id, name, address, area, city, phone, is_open, opening_hours,
  latitude, longitude, is_active) on public.branches to authenticated;
grant update (name, address, area, city, phone, is_open, opening_hours,
  latitude, longitude, is_active) on public.branches to authenticated;

grant select on public.memberships to authenticated;
grant insert (user_id, restaurant_id, branch_id, role, is_active) on public.memberships to authenticated;
grant update (branch_id, role, is_active) on public.memberships to authenticated;

grant select on public.audit_logs to authenticated;
grant insert (restaurant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  on public.audit_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.branches enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_logs enable row level security;

-- profiles ------------------------------------------------------------------
create policy "profiles: read own, same restaurant, or super admin"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or private.shares_restaurant(id)
    or (select private.is_super_admin())
  );

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- restaurants ---------------------------------------------------------------
-- No insert policy: restaurants are created only by create_restaurant_with_owner().
-- No delete policy: nobody deletes a restaurant through the API.
create policy "restaurants: members and super admin read"
  on public.restaurants for select to authenticated
  using (private.is_member(id) or (select private.is_super_admin()));

create policy "restaurants: owner updates"
  on public.restaurants for update to authenticated
  using (private.has_role(id, '{owner}'))
  with check (private.has_role(id, '{owner}'));

-- branches ------------------------------------------------------------------
create policy "branches: read accessible branches"
  on public.branches for select to authenticated
  using (private.can_access_branch(id) or (select private.is_super_admin()));

create policy "branches: restaurant-wide owner/manager create"
  on public.branches for insert to authenticated
  with check (
    private.has_role(restaurant_id, '{owner,manager}')
    and private.has_restaurant_wide_access(restaurant_id)
  );

create policy "branches: owner/manager update branches they can access"
  on public.branches for update to authenticated
  using (
    private.has_role(restaurant_id, '{owner,manager}')
    and private.can_access_branch(id)
  )
  with check (
    private.has_role(restaurant_id, '{owner,manager}')
    and private.can_access_branch(id)
  );

-- memberships ---------------------------------------------------------------
-- No delete policy: staff are deactivated (is_active = false), never deleted.
create policy "memberships: read own, owner/manager read all, super admin"
  on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_role(restaurant_id, '{owner,manager}')
    or (select private.is_super_admin())
  );

create policy "memberships: owner adds non-owner members"
  on public.memberships for insert to authenticated
  with check (
    private.has_role(restaurant_id, '{owner}')
    and role <> 'owner'
    and user_id <> (select auth.uid())
  );

create policy "memberships: owner edits other members, never to owner"
  on public.memberships for update to authenticated
  using (
    private.has_role(restaurant_id, '{owner}')
    and user_id <> (select auth.uid())
    and role <> 'owner'
  )
  with check (
    private.has_role(restaurant_id, '{owner}')
    and user_id <> (select auth.uid())
    and role <> 'owner'
  );

-- audit_logs ----------------------------------------------------------------
-- No update/delete policies: the log is append-only.
create policy "audit_logs: owner/manager read"
  on public.audit_logs for select to authenticated
  using (
    private.has_role(restaurant_id, '{owner,manager}')
    or (select private.is_super_admin())
  );

create policy "audit_logs: members insert own entries"
  on public.audit_logs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_member(restaurant_id)
  );
