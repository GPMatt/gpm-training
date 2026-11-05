# Handoff: design the two turn checklists (P03 GPM Turn Schedule)

You are starting with an empty context. Matt (Matthieu Fournier, Operations at Green Property
Management, Grand Rapids MI) will work out the two inspection checklists with you. Read this whole
brief, then read `TURN_PLAN.md` in this folder (the current plan). Visual of the flow:
https://claude.ai/artifact/2wMcYR94HjYqYiDhjKWTVj

## Working rules
- Interview Matt with the AskUserQuestion tool (multiple-choice), not plain-text question lists.
- Keep answers brief. Give recommendations, not surveys.
- Commit + push right after changing files in the repo. Log decisions in TURN_PLAN.md as you go.
- Email drafts: Matt's voice (no em-dashes, sign "Matt"), draft only, never send.
- Nothing gets built yet. This is design.

## The project in one paragraph
GPM is rebuilding how unit turns (move-out to rent ready) are scheduled. A confirmed move-out date in
AppFolio starts a turn. Spencer (leasing/turn lead) books a pre-move-out inspection (PMI) with the tenant,
walks the unit, and records the scope. From that scope the system books vendors in a fixed order of 11
steps and tracks them on a daily brief. Data lives in Supabase; AppFolio stays the system of record.

## The 11 steps (locked order; all as-needed except step 1)
1 Walk/PMI · 2 Project estimates (Jason, project-eligible properties only) · 3 Tub repair (Surface Tech)
or replace (Grand River Plumbing) · 4 Flooring (Eastpointe) · 5 Drywall/plaster · 6 Appliances · 7 Tech
(Riley, in-house) · 8 Paint (Trevor; FULL paint assumed unless stated otherwise) · 9 Clean (GR Cleaning
Co or Up & Up; grease/smoke units also get a day-1 pre-clean) · 10 Stainless steel + stovetop (Surface
Experts) · 11 Carpet cleaning.

## Who walks
- Cookie-cutter properties (11 big multifamily complexes, 3-4 floor plans each; list in TURN_PLAN.md):
  Spencer walks alone, 30-45 min.
- Everything else (single-family, duplex, quad): Riley or a tech walks with Spencer, up to 1.5h, Mondays.

## Spencer's three visits
1. PMI (tenant still living there): sets the scope.
2. Move-out day: keys + security deposit. Must confirm (a) planned vendors/work still right, (b) scope
   matches and the timeline still fits the rent-ready date, (c) tenant damages for the deposit.
3. Quality checkpoint after the tech's work, before cleaners (not a step; nothing waits on it).

## THE TASK: two checklists
Inspections have two angles, so there are two checklists:

**A. Scope / charge-back checklist (Spencer).**
- Which of the 11 steps are needed, and their size (sizes drive durations; see TURN_PLAN.md table).
- Who pays for each damage/repair/replacement: tenant or owner.
- How far the turn goes, and who must be brought in (which vendors, Jason for projects).
- Must be reusable at visit 2 (confirm/changed per line, deposit damages, keys returned).

**B. Tech task list (Riley, or Spencer alone at cookie cutter).**
- What the tech physically does when it's their turn in the unit (step 7), room by room.
- Parts/supplies needed (feeds Jason's Ace/HD Supply order email).
- Idea to test: preset task list per floor plan at cookie-cutter properties; Spencer marks only exceptions.

## Hard constraints
- The checklist and photos MUST be completed in AppFolio, on the one Unit Turn work order that Spencer
  creates when he books the PMI. Billing runs off that WO. Non-negotiable.
- AppFolio has NO read API. How the system reads the checklist back out is still open (Matt is checking
  what a checklist looks like inside AppFolio). Likely path: a daily scheduled work order report (CSV)
  that includes the WO's Job Description and Instructions text but no photos. So the checklist text
  probably needs a fixed, parseable shape, e.g. one "KEY: value" line per step:
  `PAINT: full` / `TUB: resurface` / `CLEAN: heavy`. Design with that in mind, but don't lock the format
  until Matt reports back. Alternative path: the shared-WO email (PDF + photos, 18 MB cap).
- Sample export: `GPM-Claude/work_order-20261105.csv` (columns: Property Address, Unit, Created At,
  Work Order Number, Work Order Issue, Job Description, Status Notes, Maintenance Limit, Assigned User,
  Instructions, Status). Today's turn WOs are free-text, e.g. "TURN: / - check all appliances work /
  - check all blinds work / - check for clogs/leaks".
- Real example (WO 18171-1, 33 Lafayette Ave SE Apt 07, move-out inspection by Spencer). Vendor
  Instructions, room by room, with "(Charge Tenant)" tags:
  - Living Room: Missing blinds on one window. (Charge Tenant)
  - Kitchen: Cabinet hardware to put back on. New caulk around countertops. Sink stained yellow.
    Broken blinds one window (Charge Tenant)
  - Bathroom: Crack in tile around tub faucet. New shower head. New toilet seat. Toilet bolt caps.
    Wooden vanity very unstable below sink. Towel bar in tub to replace or paint where chipped.
  - Bedroom: New bulb in ceiling light fixture.
  - Keys: Missing 1 building entry key. (Charge Tenant)
  Keep Spencer's room-by-room habit and the Charge Tenant tag convention where possible.

## Existing material to build from
- Jason's "TURN checklist 2026" (Google Drive, id 1CQD_TPlhFzpN3wyr3NTS4-0Dk6gzmSpdhwQrSywkutU,
  owned by Jason): a fixture-only repair checklist (fixtures, keys, rekey, furnace filter size). It is
  the starting point for checklist B. It does NOT cover the big-ticket scope that drives the schedule.
- Gaps already identified for checklist A:
  1. Flooring, shaped like Eastpointe's "Apartment Order Form" so answers can fill it in: carpet / pad /
     rip / haul; full or partial + areas; sheet vinyl or plank + rooms; shoe molding; cove base; pull and
     reset toilet; move appliances; subfloor; floor prep; vacant/occupied; furniture left; unit style;
     access.
  2. Tub: none / resurface / replace (replace needs Grand River's measurement 2+ weeks before).
  3. Drywall/plaster: none / minor / major.
  4. Paint: full (default) / touch-up / color change / new home / none.
  5. Appliances: which to replace, make + model, photos of missing parts.
  6. Cleaning: normal / heavy / smoke or grease (adds pre-clean).
  7. Surface Experts (stainless + stovetop): yes / no.
  8. Carpet cleaning: yes / no.
  9. Blinds: measurements (single-family especially).
  10. Project flag + photos (Jason already knows which properties are project-eligible).
  11. Rooms the current sheet lacks: bathrooms past #2; walls, ceilings, doors, hardwood per room.

## Out of scope / do not raise
- Maintenance limits and owner-approval thresholds (dropped).
- Per-step price tables (dropped).
- The daily tenant-tickler switch (Matt handles it).

## Deliverable
Two checklist designs Matt approves (fields, allowed values, who fills each, which visit), written into
this folder (e.g. CHECKLISTS.md) and summarized in TURN_PLAN.md, plus a note on how each field maps to a
turn step and duration.
