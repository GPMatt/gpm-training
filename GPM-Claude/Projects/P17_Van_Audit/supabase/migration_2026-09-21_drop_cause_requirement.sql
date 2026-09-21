-- Matt's call 2026-09-21: the app no longer prompts for a cause code on a
-- count mismatch at all -- it submits instantly, same as a matching count.
-- The mandatory-reason rule (locked 2026-08-20, see schema.sql's design
-- notes) is deliberately dropped, not worked around -- cause_code_id and
-- the follow-up fields (wo_property/wo_unit/wo_number/borrowed_to/
-- expected_order_date) are still there for any row that happens to have
-- one (old data, or a future manual entry), but nothing enforces or
-- collects it going forward. repeat_offenders and missing_parts_report
-- still work off delta/expected/actual -- they just carry no reason.
--
-- Run once in the SQL Editor, same as the other migrations here.

alter table audit_lines drop constraint cause_required_on_discrepancy;
