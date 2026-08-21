-- One-time migration for the live project — run once in the SQL Editor.
-- Adds is_test so testing never has to leak into real reporting, and
-- updates the two views to exclude it. Safe to re-run (idempotent).

alter table audit_sessions add column if not exists is_test boolean not null default false;

create or replace view repeat_offenders as
select van_id, part_id,
       count(*) filter (where delta < 0) as misses_in_last_4,
       count(*)                          as sessions_considered
from (
  select al.*, s.van_id,
         row_number() over (partition by s.van_id, al.part_id order by s.completed_at desc) as rn
  from audit_lines al
  join audit_sessions s on s.id = al.session_id
  where s.status = 'completed' and not s.is_test
) recent
where rn <= 4
group by van_id, part_id
having count(*) filter (where delta < 0) >= 3;

create or replace view missing_parts_report as
select s.completed_at::date as audit_date, v.label as van, t.name as tech,
       p.part_number, p.name as part_name,
       al.expected_qty, al.actual_qty, al.delta,
       cc.label as reason,
       al.wo_property, al.wo_unit, al.wo_number, al.borrowed_to, al.expected_order_date
from audit_lines al
join audit_sessions s on s.id = al.session_id
join vans v on v.id = s.van_id
join techs t on t.id = s.tech_id
join parts p on p.id = al.part_id
left join cause_codes cc on cc.id = al.cause_code_id
where al.delta <> 0 and s.status = 'completed' and not s.is_test
order by v.label, p.name;

-- (Today's leftover test sessions on Van 3 were already cleaned up directly
-- while building this — nothing left to delete here.)
