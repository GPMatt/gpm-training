-- One-time roster seed. Run in the Supabase SQL Editor.
-- After this, manage the roster from Table Editor -> techs (see README note
-- in project memory): add a row for a new hire, or set active = false for
-- someone who's left. Never delete a row — audit_sessions references techs
-- by id, and the schema deliberately has no delete policy on anything.

insert into techs (name, role) values
  ('John', 'tech'),
  ('Laura C', 'tech'),
  ('Joe', 'tech'),
  ('Riley', 'tech'),
  ('Jason', 'supervisor'),
  ('Matt', 'supervisor')
on conflict (name) do nothing;
