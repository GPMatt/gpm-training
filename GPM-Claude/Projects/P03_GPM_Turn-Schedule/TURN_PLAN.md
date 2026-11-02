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

## Flow (revised 2026-11-02 evening; visual: https://claude.ai/artifact/2wMcYR94HjYqYiDhjKWTVj)
1. **Trigger.** The AppFolio tenant tickler is pulled DAILY into Supabase, in
   the dashboard project (no Supabase project slots left). A "Notice" row =
   turn with an UNCONFIRMED move-out date. A "Move-out" row = final date. No
   date-change alerts are needed.
2. **PMO time.** PROPOSED: an all-day "PMO needed by <date>" hold on the GPM
   Turns calendar for the next Monday. Spencer drags it to a time, and the
   system detects that. No routing and no confirmation email. (Not yet
   approved by Matt.)
3. **PMO walk.** The tech (mostly Riley) completes Jason's "TURN checklist 2026"
   (fixtures, keys, rekey, filter size). Spencer completes a new scope section
   (each of the 10 steps needed or not, plus its size, appliance make/model,
   blind measurements). Both live in one web app. Subject to change.
4. **Owner approval.** If the estimate is over the property's AppFolio
   Maintenance Limit (already in Supabase weekly via the Work Order report,
   fact_work_order.maintenance_limit), the step waits for a manual "approved"
   trigger.
5. **Booking.** Vendors get automatic calendar invites (date, window, address
   and unit, scope, access). Under 30 days' notice is still automated (earliest
   open dates). Jason assigns the tech, mostly Riley.
6. **Rent ready.** Spencer marks it, for now.
7. **Monday meeting.** Spencer + Matt.

## Emails (all separate)
| | To | When | Content |
|---|---|---|---|
| A | PM | On notice, again after the PMO | Rent-ready estimate (maximum timeline before the PMO, computed after) |
| B | PM | When the PMO gets a time | PMO scheduled + reminder to send the AppFolio entry notice |
| C | PM | After the PMO | Scope + estimate to forward to the owner; reminder to create/update the turn WO marked Unit Turn |
| D | Jason | After the PMO | Supplies to order (Ace / HD Supply): property, unit, items |
| E | Vendors | When a step is booked or shifted | Calendar invite |
| F | Spencer + Jason | Daily | Upcoming + active turns, 10 step statuses (Skipped / Unconfirmed / Scheduled / Complete), calendar + checklist links |

## Responsibilities
- PM: creates and updates the turn WO, sends the entry notice, forwards C to the owner.
- Jason: minimal work + oversight, assigns the tech, orders supplies.
- Spencer: PMO scope, move-out walk, rent ready, Monday meeting (with Matt).
- Tech (mostly Riley): the TURN checklist at the PMO, the step 7 work.

## Removed
PMO routing + Thursday confirm, the short-notice hand-schedule drafts, date-change
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
- [ ] Price table per step and size (for the owner estimate); does a $0 limit
      mean no limit or approve everything?
- [ ] Who marks each step Complete?
- [ ] Approve or replace the calendar-hold PMO idea
