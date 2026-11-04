-- One-time migration for the live project. Paste the whole file into the
-- Supabase SQL Editor and run it once. Safe to re-run (idempotent).
--
-- 2026-11-04 bin-count audit (design signed off by Matt the same day):
--   * tech enters ONE total per bin (bins 1-25), then Bin 0 = broken items
--     (part + qty) last
--   * bin passes when  counted total + broken items whose home bin it is
--     = sum of expected qty for that bin; over OR under is "off"
--   * off bins get one blind recount; still off -> per-part count of just
--     that bin (stored in the existing audit_lines table)
--   * green / red result is emailed to Matt + Jason by a GAS web app, which
--     stamps email_sent_at so it never sends twice
--
-- 1. New 25-bin van layout (replaces the 2026-09-02 values, which ran 1-54).
--    Source: P09_Inventory-Guide/van_bin_map.csv.

alter table parts add column if not exists bin_number integer;

update parts as p set bin_number = v.bin
from (values
  ('45947', 10),
  ('42296', 10),
  ('4875530',  2),
  ('4230496', 10),
  ('3008737',  1),
  ('3413846',  1),
  ('32625',  1),
  ('32886',  1),
  ('32327',  1),
  ('34574',  1),
  ('34573',  1),
  ('5622386', 22),
  ('5300587', 22),
  ('50400', 22),
  ('5238548', 23),
  ('5967955', 24),
  ('5315544', 24),
  ('50361', 23),
  ('50021', 23),
  ('5366703', 23),
  ('5395579', 22),
  ('5215033', 23),
  ('5299516', 22),
  ('5107859', 22),
  ('3007267', 16),
  ('3202181', 19),
  ('3272192', 15),
  ('3202389', 16),
  ('3007226', 19),
  ('3202199', 19),
  ('3500162', 17),
  ('31036', 21),
  ('31035', 21),
  ('3534120', 20),
  ('31034', 18),
  ('3201605', 18),
  ('3201613', 21),
  ('3201811', 18),
  ('31037', 18),
  ('3201829', 21),
  ('3202413', 16),
  ('3280955', 15),
  ('3202397', 16),
  ('3202231', 19),
  ('3202405', 16),
  ('3007218', 19),
  ('3202249', 19),
  ('3809464', 20),
  ('4233185',  6),
  ('4877353',  2),
  ('43588',  6),
  ('4903738',  6),
  ('4070843',  6),
  ('4876009',  2),
  ('4238911',  6),
  ('4568663',  6),
  ('45503',  8),
  ('4563664',  6),
  ('4165189',  6),
  ('47982', 25),
  ('4009623', 13),
  ('4563920',  6),
  ('4007568',  9),
  ('4007587',  9),
  ('4265583', 11),
  ('4200259', 11),
  ('4390985',  8),
  ('4007552',  8),
  ('4007546', 11),
  ('4201497',  8),
  ('4564241',  7),
  ('4563961',  7),
  ('4586947',  7),
  ('4564183',  7),
  ('4564209',  7),
  ('4230975',  6),
  ('43518', 11),
  ('43086',  8),
  ('4561890',  8),
  ('4562336',  8),
  ('4562005',  8),
  ('4561908',  8),
  ('40124',  8),
  ('4561916',  8),
  ('4223491', 13),
  ('48891', 13),
  ('48280', 13),
  ('48282', 13),
  ('43795', 12),
  ('48284', 13),
  ('4223111', 13),
  ('45219', 12),
  ('4223715', 13),
  ('43695', 13),
  ('4335212',  5),
  ('4335311',  5),
  ('4061123',  5),
  ('5050136', 14),
  ('5050089', 14),
  ('5050065', 14),
  ('5050051', 14),
  ('4208773',  4),
  ('4935177',  4),
  ('44094',  4),
  ('4009474',  4),
  ('40415',  4),
  ('4593554',  4),
  ('40202',  4),
  ('45438',  4),
  ('46357',  3),
  ('48076',  3),
  ('4199584',  4),
  ('4060364',  5),
  ('4060380',  5),
  ('4060398',  5),
  ('4027132',  4),
  ('59132', 22),
  ('5302211', 22)
) as v(part_number, bin)
where p.part_number = v.part_number;

-- 2. One row per bin per audit (bins 1-25).
create table if not exists audit_bin_counts (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references audit_sessions(id),
  bin_number      integer not null check (bin_number between 1 and 99),
  expected_total  numeric not null,        -- sum of van_par for this bin at session start
  counted_total   numeric not null,        -- first count
  recount_total   numeric,                 -- only when the first count was off
  broken_total    numeric not null default 0,  -- Bin 0 items whose home bin is this one
  result          text check (result in ('ok', 'off')),  -- final, after recount
  recorded_at     timestamptz not null default now(),
  unique (session_id, bin_number)
);

-- 3. Bin 0: broken items found in the van, per part.
create table if not exists audit_broken_items (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references audit_sessions(id),
  part_id      uuid not null references parts(id),
  qty          numeric not null check (qty > 0),
  recorded_at  timestamptz not null default now(),
  unique (session_id, part_id)
);

-- 4. Session outcome + email de-dupe.
alter table audit_sessions add column if not exists result        text;
alter table audit_sessions add column if not exists red_bins      integer[];
alter table audit_sessions add column if not exists email_sent_at timestamptz;

do $$ begin
  alter table audit_sessions add constraint audit_sessions_result_check
    check (result is null or result in ('green', 'red'));
exception when duplicate_object then null; end $$;

-- 5. Access. This project does NOT auto-grant new tables (bit us twice), so
--    grants are explicit. The app (anon) can read/insert/update, never delete.
alter table audit_bin_counts   enable row level security;
alter table audit_broken_items enable row level security;

drop policy if exists "read bin counts"   on audit_bin_counts;
drop policy if exists "submit bin counts" on audit_bin_counts;
drop policy if exists "edit bin counts"   on audit_bin_counts;
create policy "read bin counts"   on audit_bin_counts for select using (true);
create policy "submit bin counts" on audit_bin_counts for insert with check (true);
create policy "edit bin counts"   on audit_bin_counts for update using (true);

drop policy if exists "read broken items"   on audit_broken_items;
drop policy if exists "submit broken items" on audit_broken_items;
drop policy if exists "edit broken items"   on audit_broken_items;
drop policy if exists "remove broken items" on audit_broken_items;
create policy "read broken items"   on audit_broken_items for select using (true);
create policy "submit broken items" on audit_broken_items for insert with check (true);
create policy "edit broken items"   on audit_broken_items for update using (true);
-- Bin 0 needs a real "x" on a mistaken broken entry, but only while the
-- audit is still open.
create policy "remove broken items" on audit_broken_items for delete using (
  exists (select 1 from audit_sessions s
          where s.id = session_id and s.status = 'in_progress'));

grant select, insert, update         on audit_bin_counts   to anon, authenticated;
grant select, insert, update, delete on audit_broken_items to anon, authenticated;
grant all on audit_bin_counts, audit_broken_items to service_role;

-- 6. Check: should return 118 / 25 / 0.
select count(*) filter (where bin_number is not null)       as parts_with_bin,
       count(distinct bin_number)                           as distinct_bins,
       count(*) filter (where active and bin_number is null) as active_parts_missing_bin
from parts;
