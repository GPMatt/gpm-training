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
