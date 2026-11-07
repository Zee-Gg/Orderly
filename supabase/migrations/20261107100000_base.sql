-- Base: private schema for helpers, enums, shared trigger functions.

create schema if not exists private;
revoke all on schema private from public;
-- authenticated needs USAGE so RLS policies can call private.* helpers.
-- The schema is NOT in the API's exposed schemas, so it can't be called over REST.
grant usage on schema private to authenticated, service_role;

create type public.member_role as enum ('owner', 'manager', 'staff', 'kitchen', 'rider');
create type public.restaurant_status as enum ('trial', 'active', 'suspended');

-- Keeps updated_at current on every UPDATE.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Opening hours: all 7 weekdays, each either {"closed": true} or
-- {"closed": false, "open": "HH:MM", "close": "HH:MM"}.
-- close < open means the branch closes after midnight (e.g. 12:00–02:00).
create or replace function private.is_valid_opening_hours(h jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select h is null or (
    jsonb_typeof(h) = 'object'
    and (select count(*) from jsonb_object_keys(h)) = 7
    and not exists (
      select 1
      from unnest(array['mon','tue','wed','thu','fri','sat','sun']) as d(day)
      where not coalesce((
        jsonb_typeof(h -> d.day) = 'object'
        and jsonb_typeof(h -> d.day -> 'closed') = 'boolean'
        and (
          (h -> d.day ->> 'closed')::boolean
          or (
            (h -> d.day ->> 'open') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and (h -> d.day ->> 'close') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and (h -> d.day ->> 'open') <> (h -> d.day ->> 'close')
          )
        )
      ), false)
    )
  );
$$;

-- Returns null instead of raising for text that isn't a uuid (storage paths).
create or replace function private.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

-- Slugs that would clash with app routes or look official.
create or replace function private.is_reserved_slug(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value = any (array[
    'admin','api','app','auth','dashboard','help','kitchen','login','logout',
    'm','menu','onboarding','orderly','orders','rider','settings','signup',
    'support','www','static','assets','dev'
  ]);
$$;
