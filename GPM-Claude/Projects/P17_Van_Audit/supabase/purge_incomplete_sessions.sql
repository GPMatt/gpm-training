-- Deletes every audit_sessions row that never got marked completed —
-- in_progress or abandoned, any van, any tech. Safe to run anytime while
-- testing: a real completed audit is never touched. This is broader than
-- purge_test_sessions.sql (which only removes is_test = true rows) — use
-- this one for a quick "wipe anything half-finished" pass.

delete from audit_line_edits where audit_line_id in (
  select al.id from audit_lines al
  join audit_sessions s on s.id = al.session_id
  where s.status <> 'completed'
);
delete from audit_lines where session_id in (select id from audit_sessions where status <> 'completed');
delete from audit_sessions where status <> 'completed';
