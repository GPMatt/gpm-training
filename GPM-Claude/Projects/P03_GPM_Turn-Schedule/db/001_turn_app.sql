-- P03 GPM Turns app (Spencer's scheduling assistant), 2026-11-06.
-- Run ONCE in the Executive Dash (warehouse) Supabase SQL Editor.
-- Form answers + schedule live in jsonb so checklist field changes never need a migration.
-- RLS on with no policies: only the service_role key (used server-side by the Apps Script) can read/write.

create table if not exists public.p03_turns (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid,
  unit_id          uuid,
  property_label   text not null,
  unit_label       text,
  af_wo_number     text,
  move_out_date    date,
  move_in_date     date,
  rent_ready_date  date,
  stage            text not null default 'scheduling',
  scope            jsonb not null default '{}'::jsonb,
  tech_prep        jsonb,
  move_out_check   jsonb,
  steps            jsonb not null default '[]'::jsonb,
  archived         boolean not null default false,
  created_by       text,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists p03_turns_active_idx on public.p03_turns (archived, move_out_date);

create table if not exists public.p03_turn_settings (
  id          text primary key,
  value       jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.p03_turns enable row level security;
alter table public.p03_turn_settings enable row level security;

-- This project does not auto-grant new tables (see 2026-10-05 keepalive bug). Explicit grants:
grant select, insert, update, delete on public.p03_turns to service_role;
grant select, insert, update, delete on public.p03_turn_settings to service_role;
