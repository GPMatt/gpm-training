-- 2026-10-06: make four vans auditable at once. Run once in the SQL Editor,
-- same as the other migrations here. Safe to re-run.

-- 1. The actual cause of "it crashes when everyone audits at once": the
--    mandatory-reason rule was removed from the app on 2026-09-21 but
--    migration_2026-09-21_drop_cause_requirement.sql was never run, so every
--    tech's mismatched count was rejected. Repeated here so this one file is
--    all that needs running.
alter table audit_lines drop constraint if exists cause_required_on_discrepancy;

-- 2. One count per part per audit. Two phones on the same audit can no
--    longer write two rows for the same part — the second becomes a
--    correction to the first (the app handles the rejection). No duplicates
--    existed when this was written.
create unique index if not exists one_line_per_part_per_session
  on audit_lines (session_id, part_id);

-- 3. One open audit per van per baseline. The app now resumes by van rather
--    than by tech + van; this makes the database enforce it too, including
--    when two phones tap Load at the same instant. Older duplicates are set
--    aside first (newest one per van is kept) or the index can't be built.
update audit_sessions s set status = 'abandoned'
where s.status = 'in_progress'
  and exists (
    select 1 from audit_sessions n
    where n.van_id = s.van_id and n.par_sync_id = s.par_sync_id
      and n.status = 'in_progress' and n.started_at > s.started_at
  );

create unique index if not exists one_open_session_per_van
  on audit_sessions (van_id, par_sync_id) where (status = 'in_progress');
