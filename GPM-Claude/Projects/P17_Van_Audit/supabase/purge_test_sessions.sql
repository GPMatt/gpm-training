-- Run anytime in the SQL Editor to wipe every session marked as a test
-- (checked "Test session" on the start screen). Safe and repeatable —
-- only touches rows where is_test = true, never real audit data.

delete from audit_line_edits where audit_line_id in (
  select al.id from audit_lines al
  join audit_sessions s on s.id = al.session_id
  where s.is_test
);
delete from audit_lines where session_id in (select id from audit_sessions where is_test);
delete from audit_sessions where is_test;
