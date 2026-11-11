# P03 Turn app: General's plan (run 1, 2026-11-09)

## Goal
Make the live turn app (deploy @3) ready for Spencer's real PMIs. When a PMI Tech Prep is submitted,
the app emails a clean, room-by-room work-order description, so Spencer can paste it into the
AppFolio Unit Turn WO by hand (there is no AppFolio write API). The email goes to Spencer + Riley, or
Spencer + Bill at Bill's five properties, with Jason cc'd. Spencer times each inspection with a
start/end timer. Bill's properties are walked by Spencer alone, and Bill does the tech work.

## Acceptance criteria
1. **Email on submit.** Submitting PMI Tech Prep (final submit, not Save draft) sends ONE email from
   automation@: To = spencer@ + riley@ (or spencer@ + bill@ at a Bill property), Cc = jason@.
   Spencer is on it every time. Re-saving an already-submitted Tech Prep does NOT send again; a
   "Resend email" button sends it again on purpose.
2. **Subject:** `Turn WO description: <property> <unit>`, plus the AppFolio WO # when known.
3. **Body** (plain text first, ready to paste into AppFolio), in Spencer's format:
   - One line per room that has Fix items: `Kitchen: <note, or item name if no note>. <next>.`
     `(Charge Tenant)` goes right after each tagged item. Rooms keep the checklist order, and repeated
     rooms are numbered (Bedroom 1, Bedroom 2). Rooms with no Fix items are left out.
   - `Keys:` line from the counts (entry keys vs 2 required, mailbox, remotes), plus the lock action
     (Re-key / Replace + lock type). Missing keys can carry (Charge Tenant).
   - Below a divider, not part of the paste: **Parts to order** (item, qty, store, blind sizes,
     furnace filter size), **Not checked** items (with the reason), **Tech hours estimate**, and
     **PMI time** (start, end, total hours).
   - Same input always gives the same text (built from the form, no AI).
4. **Bill's properties** (settings list, editable in Settings): 2340 Michael Ave SW (Pinery Woods),
   2935 Oak Valley Ave SW (Oak Valley), 2700 Clyde Park Ave SW (Woods Edge), 2860 Taft Ave SW,
   3608 Havana Ave SW. At these properties: walk type is set to "Spencer alone (Bill's property)",
   the Tech step's vendor is Bill, and the email goes to Bill instead of Riley.
5. **Charge tenant + notes per line.** On Tech Prep, every Fix line has a Charge tenant toggle, and
   any line can take a note. The keys counts have a Charge tenant toggle too. (Needed for AC 3.)
6. **Inspection timer.** A "Start timer" button at the top of the PMI Scope form, and of Tech Prep
   when Spencer fills it. It shows the time running. The submit button reads "Submit + end timer"
   on whichever form ends the walk: Scope at a Riley walk, Tech Prep when Spencer walks alone
   (cookie cutter or Bill's). Start and end are saved on the turn and can be edited afterwards.
   Total hours show on the turn. If the phone closes mid-walk, the running timer survives a reload.
7. **Test switch.** Script Property `EMAIL_TEST_TO`: when set, every email goes ONLY to that address
   (subject prefixed `[TEST]`). The switch stays set until Matt approves real sending.
9. **Never name Riley for someone else's work.** "Not checked at the PMI" (shows who filled Tech Prep);
   new tech items go to "the tech's list" (Riley or Bill by property). App, email and mock.
10. **Move-out scope check is required and structured (P4).** Submit is blocked until: "Does the scope
   still match the PMI?" Yes/No is answered (No = at least one change row), every not-checked item has
   an answer, and Keys received is ticked. Change rows: Add a trade (trade + size), Change a size,
   Remove a trade, New tech item (+ extra hours), Other vendor item (Jason).
11. **Impact preview, then Apply.** Change rows show a live before/after: each step's old and new date,
   rent ready old -> new (business days), move-in buffer OK or not, and which CONFIRMED vendors moved.
   "Apply to schedule" rebuilds the dates from the first build day (next business day after move-out).
12. **Conflicted schedule.** After Apply, every confirmed step whose date moved becomes "Reschedule"
   (red), the turn shows a red "Schedule conflicted: N vendors to re-contact" banner on the board and
   turn page, and a re-contact list shows each vendor's phone/email (from Settings contacts, with known
   defaults) and a fresh copy-ready message. Marking a step Confirmed again clears it; the banner
   clears when none are left.
13. **Change email.** Apply sends one email (same recipients + test switch as AC 1/7): the changes, the
   dates that moved, and old -> new rent ready.
8. Existing behaviour is unchanged: engine tests pass, the schedule builds the same, old turns open.

## Live surface (impactful)
- Web app /exec = deploy @3 (domain users; Spencer said he'll test it). `clasp deploy -i` = Matt only.
- Supabase Executive Dash: `p03_turns`, `p03_turn_settings` (prod rows). Testers write only TEST-labelled
  turns and archive them after.
- automation@ mailbox: any email to anyone but Matt = Matt only (AC 7 switch keeps tests to Matt).
- New OAuth scope (send mail): Matt has to run `checkSetup` (Code.js) once in the editor to authorize.

## Parts
- **P1 · worker A (UI)**: `app/App.html`, `app/Config.html`. Bill list + walk type + Tech vendor
  (AC 4), per-line charge/note (AC 5), timer (AC 6), calls `apiSendTechPrepEmail(turnId)` after the
  first final submit, plus the Resend button (AC 1). Verify: `node app-test/build-preview.js` preview
  renders; engine tests pass.
- **P2 · worker B (server)**: new `app/Describe.js` (pure builder: turn object -> {subject, text,
  html}), `app/Code.js` (`apiSendTechPrepEmail(turnId)`: reads the turn from Supabase, picks the
  recipients, honours EMAIL_TEST_TO, records `tech_prep.email_sent_at`), `app/appsscript.json`
  (+ send_mail scope), `app-test/describe.test.js`. Verify: node test feeds the 2361 #4 example and
  Spencer's sample, and asserts the exact text.
- Data contract both workers follow: `tech_prep.checklist[roomId][i] = {s, note, charge}` (keep the
  existing key shape, add `charge`); `tech_prep.keys_charge` (bool); `scope.pmi_timer` or
  `tech_prep.pmi_timer` = `{start, end}` ISO; settings `billProperties: [addresses]`.
- **P4 · worker A then B**: A does the move-out UI + engine (App.html, Config.html, Engine.html),
  B adds `apiSendMoveOutEmail(turnId)` (Code.js, Describe.js). Contract: `move_out_check.scope_matches`
  'Yes'|'No'; `move_out_check.changes = [{type:'add'|'resize'|'remove'|'tech'|'vendor', trade, size,
  note, hours}]`; `move_out_check.impact = {applied_at, rr_before, rr_after, moved:[{key, label, vendor,
  before, after, was_confirmed}]}`; step status `'resched'` = confirmed but moved.
- **P3 · worker C (tester)**, after P1 + P2 merge: push to a NEW test deployment (not @3), set
  EMAIL_TEST_TO = matt@, run every criterion with a TEST turn at a Riley property and at a Bill
  property, report pass/fail with evidence. Archive the test turns.
- **General**: merges A + B, `clasp push`, commits per verified part, brings Tier 3 to Matt.

## Out of scope
- The suggested checklist additions from the mock (new lines, laundry block, etc.) until Spencer +
  Jason confirm them. Only the per-line charge/note mechanics go in now.
- Any write to AppFolio. RingCentral texts, vendor emails, daily brief, tickler intake.
- Move-out PMI-damages carry-over and keys-returned count (the scope-change part IS in scope, P4).
- Wesley / Oakwood tech routing.

## Decision log
- 2026-11-09 Bill does tech work at Pinery Woods, Oak Valley, Woods Edge, Taft, Havana; he does no
  inspections (on site daily); Spencer walks those alone (Matt).
- 2026-11-09 Tech Prep submit -> email for the manual AppFolio WO; Spencer always, Riley or Bill,
  Jason cc; from automation@; text built from the form, no AI; includes parts, not-checked, tech hours (Matt).
- 2026-11-09 Spencer logs inspection hours with a start-timer button at the top and the submit button
  ending the timer (Matt).

- 2026-11-09 Matt OK'd this plan. Added: never name Riley for work someone else did. Not-checked items
  and new tech items are labelled by who filled Tech Prep / whose property it is (Riley or Bill).
- 2026-11-09 Move-out "Scope changes" becomes REQUIRED and structured to show its impact on the schedule
  that starts the next business day (moved into scope; design pending Matt's answers, P4).

- 2026-11-09 Move-out: preview then Apply; conflicted schedule made obvious with re-contact list +
  vendor contact info; required = scope Yes/No, every not-checked answered, keys received (photos not
  required); all 4 change types; change email to Spencer + tech + Jason cc (Matt).

- 2026-11-09 Matt: EMAIL_TEST_TO = matt@ is set; checkSetup run (send_mail authorized). Test deploy
  AKfycbw_6vLB-pW... (@5), live @3 untouched.
- 2026-11-09 Move-out gate = option C: a "No" answer can be submitted WITHOUT Apply. Optional
  (default on) alert email at submit: `apiSendMoveOutAlert` from `move_out_check.pending_impact`; red
  "Scope changed, not applied to schedule" banner until Apply. Round 2 also: new-turn gantt fix, full
  Undo after Apply, "Edit changes" (re-apply from the pre-Apply snapshot) (Matt).

## Round 4 (Matt, 2026-11-10, after his first test on the test deploy)
- R4.1 Cookie cutter adds 2340 Michael Ave SW (Pinery Woods), 2935 Oak Valley Ave SW, 2700 Clyde Park Ave SW.
- R4.2 Tech by property: settings.techProperties = [{tech:'Bill', email:'bill@greenpropertymgt.com',
  walks:false, addresses:[5 Bill addresses]}, {tech:'Wesley', email:'wesley@greenpropertymgt.com', walks:true,
  addresses:['547 Cherry St SE']}]. Wesley walks WITH Spencer (not cookie cutter): walk type "Wesley walk",
  Tech vendor Wesley, Wesley fills Tech Prep, emails go to Spencer + Wesley. Old billProperties still honoured.
- R4.3 Carpet cleaning is a default trade on new turns, like Paint and Clean.
- R4.4 Tenant damages: the move-out check is the source of truth. Scope damages, Tech Prep charge-tenant
  lines and missing keys all carry into the move-out "Final tenant damages" list; Spencer marks each
  Charge / Don't charge (required) and can add new ones.
- R4.5 Conflict review email to matt@ whenever a move-out scope change moves confirmed vendors (on Apply
  and on the not-applied alert): changes, moved vendors, and the same vendors' bookings on other open
  turns, so Matt can look for swaps.
- R4.6 Google Calendar: every turn step (and rent ready) syncs to automation@'s calendar (settings.calendarId,
  default 'primary'). Updates on every save, removed on archive. Needs the calendar scope (Matt re-authorizes).
- R4.7 Bugs: OK on a checklist line collapses the room (stays open now); lowering the bedroom/bathroom count
  never drops answers silently (confirm in the form: remove those answers or keep the count).
- R4.8 Blinds = rows: + Add blind -> room (dropdown of the unit's rooms), window, size. Replaces the free-text
  sizes box (old values still shown).

## For the real release (Matt, 2026-11-09)
- When a scope change moves confirmed vendors, consider SWAPPING or rearranging instead of
  rescheduling: offer the same vendor a different day or a different unit (another turn's slot), since
  one vendor does most trades. Goal: avoid cancellation fees. Needs a cross-turn view of each vendor's
  booked days.
- (2026-11-10) Track every vendor we use with a grade for quality of work, availability and cost.
  Vendors with good availability fill holes in the schedule when the scope grows at the move-out check.

## Noticed (not done)
- 2340 Michael, 2935 Oak Valley, 2700 Clyde Park were taken off the cookie-cutter list on 11/6
  ("now Riley walks"). Bill's rule now makes them Spencer-alone again. Bill's rule wins in this plan.

## V1 (Matt, 2026-11-11): phone-first checklists, vendor book, WO copy, go live today
- V1.1 The three forms (PMI Scope, Tech Prep, Move-out) are rebuilt phone-first INSIDE the same app (same URL,
  same data), styled like the checklist mock (one-tap OK / Fix / N/A / Not checked, big touch targets, sticky
  submit). Board + gantt stay as they are.
- V1.2 Checklist additions: PORCH LIGHT only (Exterior). Every other mock suggestion stays out.
- V1.3 Settings gets a VENDOR BOOK: company name, trade, contact name, email, cell. It replaces the
  "Vendor contacts" table (existing contacts seed it). Text/Email buttons + re-contact list read from it.
- V1.4 AppFolio WO read-back by shared-WO email is SCRAPPED. The app drafts the WO description and offers
  "Copy for AppFolio WO" to Spencer's clipboard. The Tech Prep email to the tech + Jason STAYS.
- V1.5 PMI timer is OUT of V1 (UI removed; old saved times still display).
- V1.6 Go-live: round 5 is not tested separately. Build V1 on top, ONE combined test pass on the test
  deploy, then live. EMAIL_TEST_TO stays on matt@ until Matt says go.

## 2026-11-11 later (Matt)
- Tub resurface sits OVERNIGHT only: no cure day (defaults, saved Settings and the one open resurface turn updated).
- 5943 8th Ave off the cookie-cutter list. Tech Prep: "Locks + keys" removed (every unit is re-keyed, unsaid);
  "Items left behind" removed (Tech Prep is before move-out).
- Schedule mock (new): based on Jason's "Apartment Turn Schedule" (Drive 19ADPJ4X8s4wolt2RBApTmUMUu9rT3sEi6uWNACxadkE).
  Two views with one toggle: BY UNIT (each unit's scope steps in order: date, vendor, status) and BY VENDOR (each
  vendor's jobs across units by day). Desktop first (Spencer + Jason at a computer). Interactive: tap a step to edit
  (date, vendor, status), filters (property / vendor / trade / status), conflict flags (vendor double-booked, order
  broken). Real units from Jason's sheet, scope + dates only, no tenant notes. Private artifact until Matt shares it.
