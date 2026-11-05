# GPM Turn Plan (P03 / to-do #17)

Current state as of 2026-11-05 (after the 2026-11-04 team meeting). Nothing is built yet.
Visual: https://claude.ai/artifact/2wMcYR94HjYqYiDhjKWTVj (v7, shared "anyone with the link").
Artifact source is kept in this folder as `turn-flow.html` (republish with the Artifact tool + that url).

## The problem
1. The turn sheet isn't seamless.
2. The turn process loses days; units aren't ready soon enough.

## The theory
The turn starts at the confirmed move-out, not the move-out itself. A comprehensive PMI is the single
source of scope, and vendors are booked ~30 days out, so dates are locked before the tenant leaves.

## Terms
- **PMI** = pre-move-out inspection (was "PMO"; renamed everywhere 2026-11-03).
- **Cookie cutter** = big multifamily, 3-4 floor plans across many units. Spencer walks alone, 30-45 min.
- **Riley walk** = any property NOT on the cookie-cutter list (SFH, duplex, quad). Riley or a tech walks
  with Spencer, up to 1.5h. These PMIs go on Mondays (Monday matters only because it suits Riley).

## Order of operations (locked; all as-needed except the walk)
1. Walk / PMI
2. Project estimates (project-eligible properties only; Jason)
3. Tub repair (Surface Tech) or replace (Grand River Plumbing)
4. Flooring (Eastpointe)
5. Drywall / plaster (all of it, after flooring)
6. Appliances
7. Tech
8. Paint (FULL paint assumed unless the checklist says otherwise)
9. Clean
10. Stainless steel + stovetop: Surface Experts (after cleaners, before carpet cleaning; confirmed 11/4)
11. Carpet cleaning

- Grease/smoke units get a pre-clean on Day 1 (before step 3); step 9 cleans again.
- Only Appliances + Tech may share a day. Skipped steps pull later steps forward.
- First build step = next business day after move-out. Business days exclude weekends + GPM office holidays.
- Buffer of 1+ business day before move-in.

## Flow
1. **Trigger.** Daily AppFolio tenant tickler into Supabase (dashboard project). CONFIRMED move-out
   dates only. Excluded-owner properties skipped. Turn tagged cookie cutter / Riley walk from the list.
   Until a PMI is booked, the turn is at the top of the daily brief as "PMI not booked".
2. **Spencer books the PMI (visit 1).** Spencer builds his own schedule. What he does every time:
   1. Emails the tenant FROM APPFOLIO to set the PMI time (record stays on the tenant).
   2. Creates the ONE Unit Turn work order in AppFolio, picking property + unit from AppFolio's dropdown
      (never typed; this solves the naming problem because tickler and WO share AppFolio's names).
   3. Marks it Unit Turn.
   4. Sets the WO scheduled date/time = the PMI. This is how the system knows the PMI is booked.
   5. Non-cookie-cutter: books a Monday and assigns/notes Riley on the WO.
   - System derives "Riley needed" from the property list, not from Spencer.
   - Brief flags: confirmed move-outs with no PMI; Riley-walk PMIs not on a Monday.
   - OPEN: whether Spencer's AppFolio email to the tenant counts as the entry notice.
3. **PMI walk.** Scope checklist (Spencer) + tech task list (Riley, or Spencer alone at cookie cutter).
   Checklist + photos go on the turn WO in AppFolio (non-negotiable: billing needs it).
4. **Project estimates + vendor booking.** Vendors get calendar invites. Under-30-days = separate
   process (not designed). Vendor booking process: Matt designing.
5. **Move-out day (visit 2).** Spencer, on the confirmed move-out date: keys + security deposit. Confirms:
   (a) vendor schedule/work still right, (b) scope matches + timeline fits rent-ready date,
   (c) tenant damages for the deposit. New scope -> Spencer books that vendor ASAP; later steps shift.
6. **Build days + visit 3.** Visit 3 = quality checkpoint (NOT a step, nothing waits on it), after the
   tech's work, before the cleaners. Spencer marks steps Complete + rent ready (for now).
7. **Daily brief + Monday meeting.** Brief: weekdays only, none on weekends or GPM office holidays.
   Monday 30-min meeting: Spencer + Matt.

## Emails (all separate; relettered 2026-11-05)
| | To | When | Content |
|---|---|---|---|
| A | PM | Confirmed move-out, again after PMI | Rent-ready date (move-out + 15 business days before PMI; computed from scope after) |
| B | Jason | Confirmed move-out at a project-eligible property | Heads-up to plan the project |
| C | Jason | After the PMI | Supplies to order (Ace / HD Supply): property, unit, items |
| D | Vendors | Step booked or shifted | Calendar invite (date, window, address/unit, scope, access); Eastpointe also gets its order form |
| E | Spencer + Jason | Weekday mornings | Top: PMIs not booked. Then upcoming + active turns, 11 step statuses |

Dropped 2026-11-05 (superseded because Spencer now books the PMI and creates the turn WO):
old "PMI scheduled" email to PM, old "scope brief so PM creates the WO" email.

## Responsibilities
- Spencer: books PMIs with tenants (AppFolio email), creates the turn WO, all 3 visits, scope checklist,
  marks steps Complete + rent ready, Monday meeting with Matt.
- Riley / tech: walks non-cookie-cutter PMIs (Mondays), tech task list, step 7 work.
- Jason: minimal work + oversight, assigns the tech, orders supplies, project estimates.
- PM: receives rent-ready dates.

## Property lists
Cookie cutter (Spencer alone; unit counts):
900 Leonard St NW, Grand Rapids 49504 (120) · 2935 Oak Valley Ave SW, Wyoming 49519 (117) ·
547 Cherry St SE, Grand Rapids 49503 (99) · 2340 Michael Ave SW, Wyoming 49509 (92) ·
6611 Prairie Winds Dr, Zeeland 49464 (80) · 90 Wealthy St SE, Grand Rapids 49503 (61) ·
5943 8th Ave, Grandville 49418 (60) · 1960 Burton St SE, Grand Rapids 49506 (46) ·
2700 Clyde Park Ave SW, Wyoming 49509 (37) · 100 Commerce Ave SW, Grand Rapids 49503 (32) ·
730 Leonard St NW, Grand Rapids 49504 (31)

Excluded entirely (owner uses own vendors):
- Kyle Visser: 956 Innes St NE 49503 · 1114 E Fulton 49503 · 228 Baynton Ave NE 49503 ·
  7620 Fase St SE, Ada 49301 · 1460 Milton St SE 49506 · 901 Sarasota Ave SE 49546
- James Debenham: 62 Caroline Pl NE 49503 · 44 Stormzand Pl NE 49503 · 1110 Broadway Ave NW 49504 ·
  800 Clancy Ave NE 49503 · 726 Eastern Ave NE 49503 · 720 Kellogg St SE 49503 ·
  1317 Lafayette Ave NE 49505 · 348 Quimby St NE 49505
- Draft to Jody (2026-11-05, unsent) asks for other owners/properties with specific vendors.

## Durations (editable settings table, from Jason 2026-10-30, business days)
| Step | Sizes |
|---|---|
| PMI | cookie cutter 30-45 min; others up to 1.5h |
| Tub | resurface 1d, then 24h no entry; replace 1d |
| Flooring | 1d (hardwood refinish: 3d per room, up to 8d per unit) |
| Drywall / plaster | 2-3d |
| Appliances | 1d (8h window), same day as tech |
| Tech | quick 4h (CP, W&S, 730) / basic 1d / first-time property 2-3d |
| Paint | full 1d (default) / touch-up 4h / color change 2d / new home 2-3d |
| Clean | 1d / heavy 2d |
| Surface Experts | TBD |
| Carpet cleaning | 1d |

## Vendors (one per trade)
| Trade | Vendor | Booking |
|---|---|---|
| Tub resurface | Surface Tech, Surfacetechs1@hotmail.com | email with date + details, 30 days' notice |
| Tub replace | Grand River Plumbing, Emails.grp@gmail.com | 30 days' notice; measures 2+ weeks before install |
| Flooring | Eastpointe Interiors (Tom Rozanski), apartmentorders@eastpointeinteriors.com, 616-272-7120 | "Apartment Order Form.pdf" (Matt's inbox); same-day cancel = trip charge |
| Drywall / plaster | Matt Luschas, mattjluschas@gmail.com | 30 days' notice, 3 days per job |
| Appliances | TBD | |
| Paint | Trevor | contact pending |
| Clean | GR Cleaning Co or Up & Up | contacts pending; asked for GR Cleaning Co calendar login |
| Stainless + stovetop | Surface Experts | contact pending |
| Carpet cleaning | TBD | confirm they work off our calendar |

## Engineering
- Supabase (dashboard/warehouse project) is the source of truth: turns, steps, vendors, durations,
  tickler feed, property lists. New tables need explicit GRANTs.
- Read-back from AppFolio (no read API): BS2, OPEN. Candidates:
  - Scheduled work order report (CSV, daily) into the warehouse pipeline. Has Job Description +
    Instructions text, no photos. Sample: GPM-Claude/work_order-20261105.csv (manual export, can be
    scheduled). Its columns lack Scheduled On and WO type; check whether the report can add them.
    Structured "KEY: value" lines in Instructions would make it parseable.
  - Shared-WO email (PDF + photos, from communications@greenproperty11.mailer.appfolio.us, body
    "No content", 18 MB cap drops photos). Fragile.
  - Matt is digging into what the checklist looks like inside AppFolio before deciding.
- Shared "GPM Turns" Google Calendar carries vendor invites (Apps Script CalendarApp, store eventId).
- Launch: migrate open turns from Jason's "Apartment Turn Schedule" sheet.

## Open items
- [ ] BS2: how checklist/PMI data is read back out of AppFolio (Matt researching)
- [ ] BS3: the two checklists (scope/charge-back + tech task list), being worked in a separate agent
      session; handoff brief = CHECKLIST_HANDOFF.md
- [ ] Does Spencer's AppFolio email to the tenant count as the entry notice?
- [ ] Jason's list of project-eligible properties (Matt collecting)
- [ ] GPM office holiday list (Matt)
- [ ] Jody: other owners/properties with specific vendors (draft ready)
- [ ] Vendor booking process (Matt designing); under-30-days process (separate)
- [ ] How Spencer knows a vendor finished
- [ ] Vendor contacts + crew calendars (asked Jason in the 11/3 email); Surface Experts duration
- [ ] Matt: switch the tenant tickler pull to daily (keep out of team emails)
