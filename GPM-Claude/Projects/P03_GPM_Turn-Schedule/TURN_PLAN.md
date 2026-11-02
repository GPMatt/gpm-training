# GPM Turn Plan (P03 / to-do #17)

Decisions from Matt's interview, 2026-11-02. Nothing is built yet.

## The problem
1. The turn sheet isn't seamless.
2. The turn process itself isn't good enough. We lose days and units aren't ready soon enough.

## The theory
The turn starts at notice, not move-out. A comprehensive PMO is the single
source of scope, and vendors are booked 30 days out, so every date is locked
before the tenant leaves.

## Order of operations (locked; every step is as-needed except the walk)
1. Walk / PMO
2. Quotes for estimates
3. Tub repair or replace
4. Flooring
5. Drywall / plaster (all of it, including tub-related, after flooring)
6. Appliances
7. Tech
8. Paint
9. Clean
10. Carpet cleaning

- Grease or smoke units get a pre-clean on Day 1, before step 3. Step 9 cleans again.
- The only same-day overlap allowed is Appliances + Tech.
- Skipped steps pull everything after them forward.
- The first build step is the next business day after move-out. Weekends are not business days.
- There's a buffer of 1+ business day before move-in.

## Flow
1. **Trigger.** The AppFolio tenant tickler is pulled DAILY into Supabase (Matt is
   switching it from weekly). A morning job picks up new notices. The portal
   email trigger is dropped.
2. **PMO scheduling.** The PMO is due within 5 business days of notice, on Mondays
   after 11am. All PMOs for that Monday are routed in drive order (P07 logic),
   with no cap. Spencer confirms the route by Thursday EOD, then each PM gets a
   reminder to send the entry notice via AppFolio.
3. **PMO.** Spencer fills out the checklist in the custom web app (Jason's
   existing checklist, optimized). Each answer picks a size from the duration
   table.
4. **Quotes.** If a step needs owner approval, the system emails a draft to
   Laura and the PM to send to the owner. That step waits for a manual
   "approved" trigger. Everything else books as normal.
5. **Booking.** Outside vendors get an email plus an invite on the GPM Turns
   calendar, sent automatically with no human approval. Jason assigns the
   in-house tech for step 7.
6. **Short notice.** If move-out is under 30 days away, the system sends Spencer
   draft emails clearly stating he has to schedule these by hand.
7. **Move-out walk.** Spencer walks the unit on move-out day or first thing the
   next day. If he finds new scope, he books that vendor ASAP himself. If that
   date pushes later steps, the system shifts them, auto-emails the affected
   vendors, and sends Jason a summary.
8. **Date change in the tickler after booking.** Alert Jason and Spencer only.
   Nothing is rescheduled automatically.
9. **Monday 30-min turn meeting.** The board shows every open turn and its
   status, plus the next 45 days of vacates. It also shows rent-ready vs
   move-in and weekly load per trade. **No alerts for overrun or capacity.**

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
| Flooring | Eastpointe Interiors, ApartmentOrders@eastpointeinteriors.com | order form (requested 2026-11-02) |
| Drywall / plaster | Matt Luschas, mattjluschas@gmail.com | 30 days' notice, 3 days per job |
| Appliances | TBD | |
| Paint | TBD | |
| Clean | TBD | |
| Carpet cleaning | TBD | |

## Engineering
- Supabase is the source of truth: turns, steps, vendors, durations, and the
  tickler feed.
- One web app holds Spencer's checklist plus the turn board.
- A read-only Google Sheet mirrors the data for anyone who wants a spreadsheet.
- The shared "GPM Turns" Google Calendar carries vendor invites.
- Launch: migrate the open turns from Jason's "Apartment Turn Schedule" sheet.

## Open items
- [ ] Matt: switch the tenant tickler pull to daily
- [ ] Jason: send the current PMO checklist; name the vendors and contacts for
      appliances, paint, clean and carpet cleaning
- [ ] Eastpointe: order form (pending from their order desk)
- [ ] Design the manual "owner approved" trigger
- [ ] Decide whether a late PMO (more than 5 business days after notice) gets
      flagged anywhere
