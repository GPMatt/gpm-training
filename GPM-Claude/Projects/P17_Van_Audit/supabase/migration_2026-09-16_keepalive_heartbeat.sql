-- A read-only SELECT keep-alive isn't a strong enough activity signal to
-- reliably block Supabase's free-tier auto-pause -- confirmed on the
-- gpm-warehouse-pipeline project, which paused on 2026-09-16 despite a
-- daily read-only ping running clean the day before. This table backs a
-- daily WRITE instead: a single row, upserted with today's date, nothing
-- downstream reads it. Run once in the SQL Editor, same as the other
-- migrations here.

create table keepalive_heartbeat (
  id smallint primary key default 1,
  pinged_at timestamptz not null default now(),
  check (id = 1)
);

insert into keepalive_heartbeat (id) values (1);

-- Added 2026-10-05: creating the table isn't enough. This project doesn't
-- auto-grant new tables to the API roles, so without this every ping 403s
-- with "permission denied for table keepalive_heartbeat" -- which is exactly
-- how the project paused on 2026-10-05 despite the daily trigger firing.
grant select, insert, update on public.keepalive_heartbeat to service_role;
