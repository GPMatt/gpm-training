-- P17 Van Audit v2 — schema
-- Replaces the Google Sheets (Live Inventory / Audit Log / Cycle State / Discrepancy Tracker)
-- with a relational structure in Supabase (Postgres).
--
-- Design decisions this reflects (locked as of 2026-08-20):
--   - Full-van audit every Monday, no category rotation.
--   - Tech identity is always a separate pick from the van — never inferred.
--   - Jason gets no PIN; picking his own name IS what marks a session supervised.
--   - One barcode per bin; the auditor always types the actual count.
--   - A cause code is required on every line where actual != expected, no $ threshold.
--   - Three causes carry extra follow-up detail; "broken" does not ask why.
--   - Jason-audit van selection is random-without-replacement, reset every month.
--   - Procurement / ACE Restock cross-reference is intentionally NOT in this schema yet.

-- ── Reference: the 8 reasons a count can be off ─────────────────────────────
create table cause_codes (
  id              smallint primary key generated always as identity,
  code            text not null unique,
  label           text not null,
  active          boolean not null default true
);

insert into cause_codes (code, label) values
  ('not_on_wo',      'Never attached to work order'),   -- follow-up: property, unit, WO #
  ('personal_use',   'Personal use'),
  ('borrowed',       'Borrowed'),                        -- follow-up: which van/account received it
  ('gpm_use',        'GPM internal use'),
  ('never_received', 'Never received from ACE'),         -- follow-up: expected order date
  ('lost',           'Lost'),
  ('broken',         'Broken'),                          -- no follow-up
  ('misplaced',      'Disorganized / misplaced');

-- ── People and vehicles ─────────────────────────────────────────────────────
create table techs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  role         text not null default 'tech' check (role in ('tech', 'supervisor')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
-- No PIN, no password. Selecting your own name from the dropdown is the entire login.
-- Jason's row gets role = 'supervisor' — that's what marks a session he runs as jason_supervised.

create table vans (
  id           uuid primary key default gen_random_uuid(),
  label        text not null unique,     -- e.g. "Van 1", "Van 2" — never a person's name
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table van_assignments (
  id             uuid primary key default gen_random_uuid(),
  van_id         uuid not null references vans(id),
  tech_id        uuid not null references techs(id),
  assigned_from  date not null default current_date,
  assigned_to    date              -- null = currently assigned
);
create unique index one_open_assignment_per_van
  on van_assignments (van_id) where (assigned_to is null);

-- ── Parts and the weekly expected-quantity baseline ─────────────────────────
create table parts (
  id           uuid primary key default gen_random_uuid(),
  part_number  text not null unique,
  name         text not null,
  category     text,
  unit_cost    numeric(10,2),
  active       boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- One row per Monday-morning AppFolio sync. Never overwritten — each week is its own snapshot.
create table par_syncs (
  id           uuid primary key default gen_random_uuid(),
  synced_at    timestamptz not null default now(),
  source       text not null default 'appfolio_csv_email',
  status       text not null check (status in ('ok', 'failed')),
  row_count    integer
);

create table van_par (
  id            uuid primary key default gen_random_uuid(),
  par_sync_id   uuid not null references par_syncs(id),
  van_id        uuid not null references vans(id),
  part_id       uuid not null references parts(id),
  expected_qty  numeric not null,
  unique (par_sync_id, van_id, part_id)
);

-- ── Jason-audit monthly picker ───────────────────────────────────────────────
-- Random-without-replacement, reset every month: every van gets exactly one
-- Jason-supervised Monday per month, order randomized so it's not predictable.
create table jason_audit_schedule (
  id            uuid primary key default gen_random_uuid(),
  audit_month   date not null,           -- first of the month
  van_id        uuid not null references vans(id),
  audit_date    date not null,           -- the specific Monday assigned
  selected_at   timestamptz not null default now(),
  unique (audit_month, van_id)
);

-- ── Audit sessions and their line-by-line results ────────────────────────────
create table audit_sessions (
  id             uuid primary key default gen_random_uuid(),
  van_id         uuid not null references vans(id),
  tech_id        uuid not null references techs(id),        -- whoever picked their name to run it
  session_type   text not null check (session_type in ('solo', 'jason_supervised')),
  par_sync_id    uuid not null references par_syncs(id),     -- which Monday's baseline this checks against
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  status         text not null default 'in_progress'
                   check (status in ('in_progress', 'completed', 'abandoned')),
  is_test        boolean not null default false   -- deliberately marked from the app; excluded from both views below
);
-- session_type is set by the app when the session starts, based on the selected
-- tech's role — a 'supervisor' selecting their name is what makes it jason_supervised.
-- jason_audit_schedule is the *plan*; this table is the *record* of what actually happened.

create table audit_lines (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references audit_sessions(id),
  part_id          uuid not null references parts(id),
  expected_qty     numeric not null,     -- copied from van_par at session start
  actual_qty       numeric not null,
  delta            numeric generated always as (actual_qty - expected_qty) stored,
  cause_code_id    smallint references cause_codes(id),

  -- follow-up detail — only ever filled for the cause it belongs to
  wo_property      text,     -- cause: not_on_wo
  wo_unit          text,     -- cause: not_on_wo
  wo_number        text,     -- cause: not_on_wo
  borrowed_to      text,     -- cause: borrowed — a van label OR a free-text account name
  expected_order_date date,  -- cause: never_received

  recorded_at      timestamptz not null default now(),

  constraint cause_required_on_discrepancy
    check (delta = 0 or cause_code_id is not null)
);

-- Nothing gets silently overwritten. A correction inserts here, then updates the line.
create table audit_line_edits (
  id                       uuid primary key default gen_random_uuid(),
  audit_line_id            uuid not null references audit_lines(id),
  previous_actual_qty      numeric not null,
  previous_cause_code_id   smallint references cause_codes(id),
  new_actual_qty           numeric not null,
  new_cause_code_id        smallint references cause_codes(id),
  edited_by                uuid not null references techs(id),
  edited_at                timestamptz not null default now()
);

-- ── Derived views ─────────────────────────────────────────────────────────
-- Same part missing from the same van in 3 of its last 4 completed audits.
create view repeat_offenders as
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

-- What you'd hand-key into AppFolio: every discrepancy, with its reason, ready to read top to bottom.
create view missing_parts_report as
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
