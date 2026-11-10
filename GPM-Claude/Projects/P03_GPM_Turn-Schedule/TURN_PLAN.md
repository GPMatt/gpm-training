# GPM Turn Plan (P03 / to-do #17)

Current state as of 2026-11-05 (after the 2026-11-04 team meeting). Nothing is built yet.
Visual: https://claude.ai/artifact/2wMcYR94HjYqYiDhjKWTVj (v7, shared "anyone with the link").
Artifact source is kept in this folder as `turn-flow.html` (republish with the Artifact tool + that url).

## 2026-11-06 MVP pivot (Matt; SUPERSEDES conflicting sections below)
- MVP = a scheduling assistant web app for SPENCER ONLY. Spencer books every vendor himself (phone,
  text, email). RingCentral + automated vendor email = later, not MVP. Approval gate dropped for now.
- TRIGGER = Spencer submits the PMI Scope form (no longer the confirmed move-out). Works for 30+ days
  out AND short-notice turns alike, so no separate under-30-days process in MVP.
- Flow: Scope form -> scheduling assistant (system lays out the recommended/optimal schedule from the
  locked order + durations; Spencer adjusts days, times of day, lengths and order) -> tracking.
- All three forms stay in MVP: PMI Scope, PMI Tech Prep, Move-out / Deposit Check. All live in the web app.
- Tech Prep form asks the tech: "how many hours do you think you'll need?"
- NO daily brief. Instead, the same app is where Spencer checks off each turn/step as accounted for,
  schedules, and tracks progress.
- Schedule is interactive; per-vendor copy-to-clipboard draft message Spencer sends himself.
- Rent-ready date visible at all times, including while editing a hypothetical schedule.
- Progress bar per turn. Theme: cream with dark green. Calendar color-coding: by unit vs by vendor TBD.
- Vendor contacts: not needed, on Spencer for now.
- Dashboard exports (incl. tenant tickler) now arrive by email DAILY (Matt switched it).
- Checklist line items: Matt + Claude draft all three, then Spencer + Jason approve by email this weekend.
- Calendar color = BY TRADE (fixed color per step), unit name printed on every block + unit filter.
- Jason's "Apartment Turn Schedule" sheet: NO migration (free-text, merged rows, Jason edits it live,
  Matt has view-only). It keeps running; new turns start in the app. Win on ease, not force.
- Stack: GAS web app (automation@, domain access) + Supabase tables p03_turns / p03_turn_settings
  (jsonb forms, db/001_turn_app.sql). Property/unit dropdowns from dim_property / dim_unit.
- BUILT 2026-11-06, deployed @1 (app/README.md has URLs + setup). Engine tests: app-test/.
  Draft field lists live in app/Config.html FORMS (Tech Prep seeded from Jason's TURN checklist 2026).
- 11/6 later (deploy @3): times = 10-minute dropdowns (6 AM-9 PM); Gantt bars clickable (details, the
  vendor's other jobs that day across all turns, "Vendor confirmed" button); status "Booked" renamed
  "Confirmed". Tech Prep checked line by line vs Jason's TURN checklist 2026: added N/A state, split
  entry lock / 2 key min, furnace filter size, key + remote counts left in unit.
- Draft email "Turn checklists: three forms to review" to Spencer + Jason (r-2496726761636172035,
  UNSENT): all three forms itemized, replies by Monday, Jason in person Wednesday.
- 11/9: paper checklist on file (PAPER_CHECKLIST.md, 2361 #4 photos). Turn-flow artifact v8 = MVP.
  Checklist mock (all 3 forms, suggested changes marked): https://claude.ai/artifact/Vk9gzah4zEJ253xNkEGjJ7
  (source checklist-mock.html, private until Matt shares it).
- MVP choices (change if wrong): rent ready = last day of work; "ready 1+ business day before
  move-in" shown green, else red (no alerts). Dumpster Divers = "Trash-out", first build step
  (provisional). Quality check (visit 3) shown on calendar on the tech's last day. Move-out form
  "rent ready holds? No" records a reason only; the date always follows the schedule. Photos stay
  on the AppFolio WO (checkbox only, no uploads in the app).

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
- Bill (maintenance tech, Matt 11/9): does ALL work at Pinery Woods, Oak Valley, Woods Edge (spelling
  unconfirmed), Taft and Havana. OPEN: is Bill (not Riley) the tech for step 7 and the PMI walk there?
- Jason: minimal work + oversight, assigns the tech, orders supplies, project estimates.
- PM: receives rent-ready dates.

## Property lists
Cookie cutter (Spencer alone). UPDATED 2026-11-06 by Matt, these are the ONLY ones for now:
900 Leonard St NW 49504 · 90 Wealthy St SE 49503 · 5943 8th Ave, Grandville 49418 · 1960 Burton St SE 49506 ·
100 Commerce Ave SW 49503 · 730 Leonard St NW 49504 · 445 Knapp St NE 49505
(Removed: 2935 Oak Valley, 547 Cherry, 2340 Michael, 6611 Prairie Winds, 2700 Clyde Park; now Riley walks.)

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
| Surface Experts | about 1h (glass-top resurface + stainless; Jody 11/5) |
| Carpet cleaning | 1d |
| Dumpster Divers | normally 1d, depends on volume (Jody 11/5) |

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
- [ ] REAL RELEASE (Matt 2026-11-10): vendor directory with grades for quality, availability and cost/pricing;
      high-availability vendors fill schedule holes when the scope grows after a move-out check.
- [ ] REAL RELEASE (Matt 2026-11-09): when a move-out scope change moves confirmed vendors, consider
      swapping or rearranging (same vendor, different day or a different unit's slot) before cancelling,
      since one vendor does most trades. Aim: avoid cancellation fees. Needs a cross-turn vendor-day view.
- [x] BS2 (2026-11-05 Matt): read-back = Spencer SHARES the turn WO by email after each visit (same
      day, photos attached; the 11/5 share of WO 18171-1 arrived at 25.5 MB, so the 18 MB fear may not
      hold). Risk = he forgets: system sends a 5pm follow-up if a PMI/visit was due today and no share
      email arrived. Daily CSV demoted to backup.
- [ ] Line items for the three forms: NOT from scratch. Start from what we already use (Jason's TURN
      checklist 2026, Spencer's WO 18171-1 room-by-room notes, current "TURN:" WOs in the CSV) and merge
      into one solid version for all use cases. Work in the checklist session.
- [ ] BS3: the two checklists (scope/charge-back + tech task list), being worked in a separate agent
      session; handoff brief = CHECKLIST_HANDOFF.md
      2026-11-05 Matt: AppFolio's inspection form CAN'T do what we need (ruled out). Back to our own
      checklist design on the Unit Turn WO. Charge-backs: tag tenant-paid items only; untagged = owner.
      No per-floor-plan preset tech lists yet.
      THREE forms: (1) PMI Scope (Spencer): steps + sizes, tenant damages, project flag, photos;
      (2) PMI Tech Prep (Riley; Spencer fills it at cookie cutter): fix list, parts to order, tools;
      (3) Move-out / Deposit Check (Spencer alone): scope + schedule still hold, rent-ready still sensible,
      final tenant damages. Splits: damages = Spencer only; appliances (repair/replace, make+model) =
      Scope; all trade sizing calls = Spencer. Rekeying (lock type, parts) = Tech Prep. Blinds (count, sizes,
      order) = Tech Prep. Key-return count + missing keys = Tech Prep (tech counts on build day).
      Move-out form has a "new tech items" section that adds to the tech list. Move-out form = EXCEPTIONS
      ONLY: the PMI scope + schedule are shown to Spencer for a visual check; he records only corrections
      or missed items, no per-line confirmation. Pests = Scope. Items left behind = Tech Prep. Rent-ready on move-out
      form = new date + reason only if it won't hold. Photos: Scope = every damage + trade item and
      appliance tags; Tech Prep = parts to match; Move-out = whole empty unit. Tech duration: the Tech Prep
      list goes to Jason and HE assigns the step-7 size. Trades outside the 11 steps (HVAC, water heater,
      big plumbing/electrical, glass, roof) = Scope "other vendor" item, Jason books by hand. Exterior =
      Tech Prep only (Jason's fixture items). Riley marks items he couldn't check at the PMI as "not
      checked"; they show on Spencer's move-out screen. Working split: CHECKLISTS.md.
      Proposal draft (unsent) in the "Turn schedule: workflow + open questions" thread, r-5713217730009034367:
      asks Jason + Spencer to confirm the split and Jason's turnaround on tech duration (same day).
      SENT 2026-11-05. Spencer: "looks fine". Jason: "Seems good", wants 30 min every Wednesday in
      person on turns (prefers face to face over email). Tech-duration turnaround NOT answered.
- [x] Spencer's AppFolio email to the tenant doubles as the entry notice (Matt 11/5).
- [ ] Jason's list of project-eligible properties (Matt collecting)
- [x] Holidays = US bank holidays (Federal Reserve calendar), not a custom GPM list (Matt 11/5).
- [ ] ON STANDBY: excluded owners. Matt emailed Laura 11/5; GPM may move ALL units to this vendor
      philosophy, so vendors must be plug-and-play (swappable per trade in the settings table).
- [ ] Vendor booking process (Matt designing). NEW 11/5: Spencer or Jason green-lights the calendar
      layout for a turn BEFORE any vendor invites/texts go out (approval gate).
- [ ] Under-30-days (Matt 11/5): same PMI start (Spencer's AppFolio email = notice). Vendors still get
      texts, but booking runs day by day because the chain order must hold. Spencer gets an email for
      every under-30 turn and confirms each booking by phone, day of. Details to design.
- [ ] Read-back note (11/5): AppFolio's 18 MB limit is on attached images, so a shared WO email can't
      carry every photo. Text + some photos only; full photo set stays in AppFolio.
- [ ] RingCentral SMS: confirm API access, which numbers can text, and business-texting (10DLC/TCR)
      registration status before designing vendor texts.
      11/5: Matt's login = Analytics only (no Admin Portal); developer portal = No_Permission.
      Draft to Laura (unsent) asks for admin/custom role. Matt on RingCentral webinar Thu 11/12.
      11/5 later: developer portal now works; sample app + JWT credential created (secret stays in
      RingCentral / Script Properties only, never in repo or email). Pre-build checks (RC docs 11/5):
      a) Sending number must belong to the logged-in extension (company numbers: one designated
         extension). Decide whose extension owns the turn number; a dedicated "Turns" user is safest.
      b) SMS is OFF by default. Local numbers need an approved TCR brand + campaign; toll-free needs
         toll-free verification. Check per number: API "list my phone numbers" -> feature SmsSender,
         and sms-configuration campaign status = Confirmed.
      c) Campaign use case must match the texts (AccountNotification / CustomerCare); vendors must
         have agreed to get texts. LowVolume tier (6,000/day) is plenty.
      d) Use standard Business SMS, not High Volume (High Volume has no MMS = no vendor photos).
      e) Replies: webhook needs an HTTPS endpoint that echoes a Validation-Token header within 3s;
         Apps Script web apps can't set response headers. Recommend GAS polling the message store
         every 5 min instead (no webhook, no new server).
      f) STOP / UNSUBSCRIBE replies: carriers block further texts; the tool must track opt-outs too.
      11/5 8:30pm: app "GPM Turn Text" (private, JWT, live in production; scopes SMS, ReadAccounts,
      ReadMessages). Local read-only check: login OK; Matt's direct +16163031061 = SmsSender + MMS
      (texting ON, registration evidently in place). +16167194460 and main 866 line = no texting.
      GAS test project "RC Turn Text Test" (rc-text-test/, clasp-pushed, owner automation@).
      11/5 8:54pm END-TO-END TEST PASSED: sendTestText -> Matt's cell; replies read back by
      checkReplies: "1" = CONFIRMED, "DONE" + 1 photo = DONE. 8:57pm STOP -> OPT-OUT, send refused; START -> OPT-IN, send Delivered.
      Fixed: replies now processed oldest-first (was newest-first, a STOP then START in one batch
      would have ended opted out). Not yet tested: 5-min trigger.
- [ ] Dumpster Divers: duration answered (normally 1d, depends on volume; Jody 11/5). Still open: where it
      sits in the 11 steps (likely right after PMI, before Projects).
- [ ] Vendor notice + "done" signal: ONE mechanism for invited / booked / finished. Many vendors are
      low-tech; Matt wants something more foolproof than a calendar invite by email. Proposal: text
      message (RingCentral SMS from a GPM number), reply 1 = confirm, reply DONE (+ photo) = finished;
      no reply by a deadline -> flagged on the brief. Calendar invite optional for vendors who want it.
- [ ] Vendor contacts: Matt sends once the booking/communication method is settled. Decision: vendors
      run off OUR calendar, not theirs (no crew-calendar logins). Surface Experts duration settled (about 1h).
- [ ] Matt: switch the tenant tickler pull to daily (keep out of team emails)
