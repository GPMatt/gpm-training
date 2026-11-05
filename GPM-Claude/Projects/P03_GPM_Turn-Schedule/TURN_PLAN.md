# GPM Turn Plan (P03 / to-do #17)

Decisions from Matt's interview, 2026-11-02. Nothing is built yet.

## The problem
1. The turn sheet isn't seamless.
2. The turn process itself isn't good enough. We lose days and units aren't ready soon enough.

## The theory
The turn starts at notice, not move-out. A comprehensive PMI is the single
source of scope, and vendors are booked 30 days out, so every date is locked
before the tenant leaves.

## Order of operations (locked; every step is as-needed except the walk)
1. Walk / PMI
2. Project estimates (bigger value-add projects only)
3. Tub repair or replace
4. Flooring
5. Drywall / plaster (all of it, including tub-related, after flooring)
6. Appliances
7. Tech
8. Paint
9. Stainless steel cleaning (Jody, as needed; separate from the cleaners; OPEN: confirm)
10. Clean
11. Carpet cleaning

- Grease or smoke units get a pre-clean on Day 1, before step 3. Step 10 cleans again.
- The only same-day overlap allowed is Appliances + Tech.
- Skipped steps pull everything after them forward.
- The first build step is the next business day after move-out. Weekends are not business days.
- There's a buffer of 1+ business day before move-in.

## Flow (revised 2026-11-02 evening; visual: https://claude.ai/artifact/2wMcYR94HjYqYiDhjKWTVj)
1. **Trigger.** Daily AppFolio tenant tickler into Supabase (dashboard project).
   CONFIRMED move-out dates only. Unconfirmed notices are not in the report and
   never start a turn. The PMI goes on the next Monday.
2. **PMI time.** Next Monday, real 1h slots stacked from 10am in the order
   move-outs were confirmed. Every tenant window is 4h, and tenants never see
   the real slot: 1st 10-11 (window 9-1), 2nd 11-12 (10-2), 3rd 12-1 (11-3),
   4th 1-2 (12-4), 5th 2-3 (1-5), 6th 3-4 (1-5). Max 6; a 7th goes to Spencer.
   Asking Jason and Spencer for the safe Monday count and a realistic start time
   after inventory + the meeting.
3. **PMI walk.** The tech (mostly Riley) completes Jason's "TURN checklist 2026"
   (fixtures, keys, rekey, filter size). Spencer completes a new scope section
   (each of the 11 steps needed or not, plus its size, appliance make/model,
   blind measurements). Both live in one web app. Subject to change.
4. **Project estimates.** IN SCOPE, but only for bigger value-add projects
   (not standard turn work, no per-step price table). The process is TBD.
5. **Booking (Matt still designing; under 30 days out needs its own process).** Vendors get automatic calendar invites (date, window, address
   and unit, scope, access). Under 30 days' notice is still automated (earliest
   open dates). Jason assigns the tech, mostly Riley.
6. **Rent ready.** Spencer marks it, for now.
7. **Monday meeting.** Spencer + Matt.

## Emails (all separate)
| | To | When | Content |
|---|---|---|---|
| A | PM | On notice, again after the PMI | Rent-ready estimate (move-out + 15 business days before the PMI, computed from scope after) |
| B | PM | When the PMI gets a time | PMI scheduled + reminder to send the AppFolio entry notice |
| C | PM | After the PMI | Scope brief so the PM can create/update the turn WO; reminder to mark it Unit Turn |
| D | Jason | After the PMI | Supplies to order (Ace / HD Supply): property, unit, items |
| E | Vendors | When a step is booked or shifted | Calendar invite |
| F | Spencer + Jason | Daily | Upcoming + active turns, 11 step statuses (Skipped / Unconfirmed / Scheduled / Complete), calendar + checklist links |

## Responsibilities
- PM: creates and updates the turn WO, sends the entry notice.
- Jason: minimal work + oversight, assigns the tech, orders supplies.
- Spencer: PMI scope, move-out walk, rent ready, Monday meeting (with Matt).
- Tech (mostly Riley): the TURN checklist at the PMI, the step 7 work.

## Removed
PMI routing + Thursday confirm, the short-notice hand-schedule drafts, date-change
alerts, capacity/overrun alerts, the portal email trigger.

## Durations (editable settings table, from Jason 2026-10-30, business days)
| Step | Sizes |
|---|---|
| Tub | resurface 1d, then 24h no entry; replace 1d |
| Flooring | 1d (hardwood refinish: 3d per room, up to 8d per unit) |
| Drywall / plaster | 2-3d |
| Appliances | 1d (8h window), same day as tech |
| Tech | quick 4h (CP, W&S, 730) / basic 1d / first-time property 2-3d |
| Paint | touch-up 4h / full 1d / color change 2d / new home 2-3d |
| Clean | 1d / heavy 2d |
| Carpet cleaning | 1d |

## Vendors (one per trade, covering all areas)
| Trade | Vendor | Booking |
|---|---|---|
| Tub resurface | Surface Tech, Surfacetechs1@hotmail.com | email with date + details, 30 days' notice |
| Tub replace | Grand River Plumbing, Emails.grp@gmail.com | 30 days' notice; must measure 2+ weeks before install |
| Flooring | Eastpointe Interiors (Tom Rozanski), apartmentorders@eastpointeinteriors.com, 616-272-7120 | "Apartment Order Form.pdf" (in Matt's inbox): install date, community/unit/style, vacant/occupied/furniture, carpet/pad/rip/haul, full or partial + area, sheet vinyl or plank + rooms, rip, shoe molding, cove base, R&R toilet, move appliances, subfloor, floor prep, special instructions, access, requested by/PO#, PM + maintenance supervisor contacts. Same-day cancel = trip charge |
| Drywall / plaster | Matt Luschas, mattjluschas@gmail.com | 30 days' notice, 3 days per job |
| Appliances | TBD | |
| Paint | Trevor | contact pending |
| Stainless steel | Jody | as needed, before the cleaners (open) |
| Clean | GR Cleaning Co or Up & Up | contacts pending; asked for a GR Cleaning Co calendar login |
| Carpet cleaning | TBD | confirm they work off our calendar |

## Engineering
- Supabase is the source of truth: turns, steps, vendors, durations, and the
  tickler feed.
- One web app holds Spencer's checklist plus the turn board.
- A read-only Google Sheet mirrors the data for anyone who wants a spreadsheet.
- The shared "GPM Turns" Google Calendar carries vendor invites.
- Launch: migrate the open turns from Jason's "Apartment Turn Schedule" sheet.

## Open items
- [ ] Matt: switch the tenant tickler pull to daily
- [ ] Jason: send the current PMI checklist; name the vendors and contacts for
      appliances, paint, clean and carpet cleaning
- [ ] Projects: does Spencer or Jason identify potential projects at the PMI? (asked)
- [ ] Safe PMI count per Monday + start time after inventory/meeting (asked)
- [ ] Under-30-days booking process (separate, not designed)
- [ ] Who marks steps Complete (Spencer mostly; how he knows a vendor is done; asked Jason)
- [ ] Vendor contacts + each crew's calendar; confirm carpet cleaner uses our calendar; login for the GR cleaning company's calendar (asked Jason)
- [ ] Spencer's scope section (Jason's checklist is fixtures only); flooring answers should fill the Eastpointe order form
- [ ] Vendor booking process (Matt designing)
- [ ] Who marks each step Complete?
- [ ] Add stainless steel cleaning (Jody, per Jason) as step 9 of 11, before Clean: confirm placement, duration, how it's booked
- [ ] Approve or replace the calendar-hold PMI idea

## Team meeting 2026-11-04 (logged 2026-11-05, interview in progress)
Confirmed by Matt:
- Trigger is murkier: PMs want to message tenants in AppFolio to schedule the PMI. Matt does not want PM judgment deciding Monday scheduling. Leaning: Spencer schedules with the tenant himself; system reads confirmed move-outs and checks each is on his schedule. Needs consistent property/unit naming.
- Cookie cutter (big multifamily, 3-4 floor plans across 10-100 units): Spencer walks alone, 30-45 min. SFH/duplex/quad: Riley or a tech walks with Spencer, up to 1.5h.
- Spencer makes 3 visits: (1) pre-move-out inspection (PMI), (2) move-out day: keys + security deposit, (3) post-turn quality check before cleaning.
- Visit 2 confirms: vendor schedule/scope still right, rent-ready date + timeline still fit, tenant damages for the deposit.
- Exclude owners Kyle Visser and James Debenhiem (spelling TBC) from auto-scheduling; they use their own vendors.
- Jason knows in advance which properties are project-eligible; Matt to get the list. Email Jason when one goes vacant.
- Two checklists: (a) scope/charge-back (tenant vs owner, how far the turn goes, who's brought in); (b) tech's physical task list.
- Surface Experts (stainless steel + stovetop) confirmed: AFTER the unit cleaners, BEFORE carpet cleaning (supersedes "before cleaners").
- Paint defaults to FULL unless explicitly stated otherwise.
- Spencer daily brief: confirmed move-outs with no PMI scheduled.
- Spencer's checklist + photos live in AppFolio on a work order (billing needs it; non-negotiable). AppFolio has no read API. Options: shared-WO email (PDF + photos, 18 MB cap, "No content" body) or the WO report CSV (has Job Description + Instructions text, no photos).
