-- One-time migration — run once in the SQL Editor. Safe to re-run.
--
-- Root cause (confirmed against two real shelf tags, 2026-08-21): the
-- barcode on an ACE-style shelf tag is a GS1 UPC/EAN number, completely
-- unrelated to the internal SKU (parts.part_number). Scanning has never
-- been able to match a part because the app was comparing the raw
-- barcode against part_number directly. This table is the crosswalk that
-- lets the app learn barcode -> part_id links as they get confirmed.

create table if not exists part_barcodes (
  id          uuid primary key default gen_random_uuid(),
  part_id     uuid not null references parts(id),
  barcode     text not null unique,
  created_at  timestamptz not null default now(),
  created_by  uuid references techs(id)
);

alter table part_barcodes enable row level security;

drop policy if exists "read part barcodes"   on part_barcodes;
drop policy if exists "link part barcodes"   on part_barcodes;
drop policy if exists "relink part barcodes" on part_barcodes;

-- Same trust model as the rest of the app: there's no real server-side auth
-- to verify "supervisor" (no PIN, no password anywhere in this schema) —
-- the PWA's UI gates who ever sees the link controls (Jason/Matt only for
-- live linking, Matt only for Teach Mode), same as session_type being
-- self-reported by tech selection elsewhere in this app.
create policy "read part barcodes"   on part_barcodes for select using (true);
create policy "link part barcodes"   on part_barcodes for insert with check (true);
create policy "relink part barcodes" on part_barcodes for update using (true);
-- No delete policy — consistent with every other operational table here:
-- the app can add or correct a link, never remove one.

grant select, insert, update on part_barcodes to anon, authenticated;
grant all on part_barcodes to service_role;
