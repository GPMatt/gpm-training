-- P17 Van Audit v2 — Row Level Security
-- Run after schema.sql. Defines what the PWA (using the anon key) is
-- allowed to do. The service_role key (Apps Script only) bypasses all of
-- this by design — these policies only constrain the anon key.
--
-- Model: reference/lookup data is read-only from the app. Only the
-- operational audit tables (sessions, lines, edits) accept writes from
-- the anon key, and only inserts/updates — nothing is ever deletable
-- from the app itself.

alter table cause_codes          enable row level security;
alter table techs                enable row level security;
alter table vans                 enable row level security;
alter table van_assignments      enable row level security;
alter table parts                enable row level security;
alter table par_syncs            enable row level security;
alter table van_par              enable row level security;
alter table jason_audit_schedule enable row level security;
alter table audit_sessions       enable row level security;
alter table audit_lines          enable row level security;
alter table audit_line_edits     enable row level security;
alter table part_barcodes        enable row level security;

-- Reference data: the app reads these to populate dropdowns and to know
-- what's expected on a van. It never writes to them directly — that
-- happens server-side (Apps Script, service_role) from the Monday sync
-- and the monthly Jason-picker draw.
create policy "read cause codes"     on cause_codes          for select using (true);
create policy "read techs"           on techs                for select using (true);
create policy "read vans"            on vans                 for select using (true);
create policy "read van assignments" on van_assignments      for select using (true);
create policy "read parts"           on parts                for select using (true);
create policy "read par syncs"       on par_syncs             for select using (true);
create policy "read van par"         on van_par               for select using (true);
create policy "read jason schedule"  on jason_audit_schedule  for select using (true);

-- Operational data: this is what the PWA actually writes.
create policy "read audit sessions"   on audit_sessions   for select using (true);
create policy "start audit sessions"  on audit_sessions   for insert with check (true);
create policy "complete audit sessions" on audit_sessions for update using (true);

create policy "read audit lines"   on audit_lines for select using (true);
create policy "submit audit lines" on audit_lines for insert with check (true);
create policy "edit audit lines"   on audit_lines for update using (true);

create policy "read audit line edits"   on audit_line_edits for select using (true);
create policy "record audit line edits" on audit_line_edits for insert with check (true);

-- No real server-side auth exists to check "supervisor" (no PIN, no
-- password anywhere in this schema) — the PWA's UI gates who ever sees the
-- link controls (Jason/Matt for live linking, Matt only for Teach Mode),
-- same trust model as session_type being self-reported by tech selection.
create policy "read part barcodes"   on part_barcodes for select using (true);
create policy "link part barcodes"   on part_barcodes for insert with check (true);
create policy "relink part barcodes" on part_barcodes for update using (true);

-- No delete policy on anything: the app can never remove a row, only add
-- or correct one. If something truly needs to be deleted, that's a
-- service_role / dashboard action, not something the PWA can do.

-- RLS policies only decide *which rows* a role can see once it's already
-- allowed to touch the table at all — Postgres still needs the baseline
-- grant below, or every request 401s with "permission denied" regardless
-- of the policies above.
grant usage on schema public to anon, authenticated;

grant select on
  cause_codes, techs, vans, van_assignments, parts, par_syncs, van_par, jason_audit_schedule
to anon, authenticated;

grant select, insert, update on audit_sessions to anon, authenticated;
grant select, insert, update on audit_lines    to anon, authenticated;
grant select, insert          on audit_line_edits to anon, authenticated;
grant select, insert, update on part_barcodes  to anon, authenticated;

-- service_role bypasses RLS but NOT the base Postgres grant — same gap as
-- above, just for the Apps Script sync (vans/parts/van_par writes) and any
-- manual admin script. Give it everything on every table in this schema.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
