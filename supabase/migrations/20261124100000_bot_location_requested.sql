-- Bot address flow: ask for the customer's current location only ONCE.
-- true = the bot already asked this chat to share its location because the
-- address had no detail (only an area). After that a rough address is
-- accepted (the order gets "Address unclear — call customer").
-- Server-only like the rest of bot_sessions (service role writes it).
alter table public.bot_sessions
  add column location_requested boolean not null default false;

comment on column public.bot_sessions.location_requested is
  'Bot asked once for a location pin (address had no detail). A rough address is accepted after that.';
