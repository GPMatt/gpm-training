-- Keep-alive for the P15 Supabase project. No other automation writes here
-- yet (no Jotform webhook, no app UI), so this table exists purely to give
-- the daily GAS ping (keepalive-live/Code.js) something to upsert into and
-- block Supabase's free-tier auto-pause. Nothing downstream reads it.
-- Run once in the SQL Editor.

create table keepalive_heartbeat (
  id smallint primary key default 1,
  pinged_at timestamptz not null default now(),
  check (id = 1)
);

insert into keepalive_heartbeat (id) values (1);

-- This schema's other tables rely on RLS + auth.uid() for the authenticated
-- role; nothing here grants the service_role key (used by the GAS ping)
-- baseline Postgres privileges on new tables. Same gap found on the Van
-- Audit project: RLS/policies alone don't cover it, and service_role still
-- 403s with "permission denied" without an explicit grant.
grant usage on schema public to service_role;
grant select, insert, update on keepalive_heartbeat to service_role;
