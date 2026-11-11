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
- (11/11) Paint "Redo trim" = 2 days. New default sizes now merge into saved Settings automatically.
- (11/11) Eastpointe: Scope asks the order-form questions only when Flooring is LVP / carpet / both (carpet: full/partial
  + area, pad, rip, haul; vinyl: plank/sheet, rooms, rip, shoe molding, cove base, R&R toilet, move appliances, sub floor,
  floor prep; style of unit; special instructions). Measure day = 1 week before install (last business day on/before
  install - 7 days), auto unless Spencer sets it; never auto-shortened. Shown on the step, both calendars and the vendor
  message, which carries the order text. Filled PDF = not yet.
- (11/11) Turn techs = Riley, Bill, Wesley only (the sheet's Tech column is WO coverage). At Bill / Wesley addresses the
  walk type + unconfirmed Tech step self-correct on load (turns created on old live @3 had Cookie cutter + Riley).
- (11/11) "Copy whole schedule" -> "Email schedule to Jason" (same text, EMAIL_TEST_TO honoured).

---

# Run 2 (General, 2026-11-11): email rewire, room close fix, iPad layout

## Goal
Rewire the app's emails so only Matt, Jason and Spencer get them, at the right moments. Jason gets the schedule as soon
as the PMI Scope builds it, so he can book vendors by hand before the move-out. Everything after the move-out comes in
ONE email. Techs and vendors get nothing from the app, and every vendor-messaging button goes. Fix Tech Prep rooms
folding shut when they are not finished. Lay out all three forms for an iPad held in landscape. The phone layout stays as it is.

## Acceptance criteria
E1. **Tech Prep email** (first final submit + Resend button): To Jason + Spencer ONLY. No tech (Riley/Bill/Wesley) ever,
    at any property. Content unchanged.
E2. **Schedule email**: the FIRST final submit of the PMI Scope (new turn or existing) automatically emails the schedule
    to Jason + Spencer. Same text as today's "Email schedule to Jason". The time it was sent is saved on the turn
    (`scope.schedule_emailed_at`), so later Scope saves don't send it again. The button stays for re-sends, relabelled
    "Email schedule to Jason + Spencer".
E3. **One move-out email** replaces the three old ones (schedule changed / NOT applied alert / conflict review): To Jason +
    Spencer, cc Matt. It is sent when the Move-out form is submitted with scope changes, and again when Apply is tapped.
    It says APPLIED or NOT APPLIED (tap Apply) at the top, then gives: rent ready old -> new, the changes, the confirmed
    vendors whose date moved, and the same vendors' jobs on other open turns within 15 business days. Vendors are named,
    techs included. One send per event: the submit sends once, and Apply sends once.
    No changes (scope matches) = no email.
E4. **No tech/vendor messaging**: remove "✉ Vendor message" (per step, modal with Copy / Text / Email), the
    "Vendors to re-contact" list, "✉ Message with new date", and the "See who" link. Steps still turn red "Reschedule"
    when a confirmed date moves, and the banner still says how many steps need rescheduling. Status buttons stay.
    The AppFolio WO copy button stays.
E5. EMAIL_TEST_TO (matt@) is still honoured by every email; the switch stays ON.
R1. **Tech Prep rooms**: a room closes by itself ONLY at the moment its last line gets an answer (any mix of
    OK / Fix / Not checked / N/A). It does not auto-open the next room. Save draft, reopening the tab, or the app re-reading
    the turn never folds a room that is unfinished or that Spencer left open. "Mark the other N OK + next room" works
    as today.
T1. **iPad landscape** (wider than 900px): Tech Prep shows the room list on the left (each room with answered/total, a
    fix count and ✓ when done) and the selected room's lines on the right. Tapping a room on the left shows it. PMI Scope
    and Move-out use the width (two columns of sections/fields) with tablet-sized tap targets. No sideways scrolling.
    Phones (760px and under) look exactly as they do on @14.
X1. Engine + describe tests pass (updated for the new recipients/emails); the local preview renders; old turns open.

## Live surface (impactful)
- LIVE deploy @3 (AKfycbxSZ...): `clasp deploy -i` = Matt only.
- TEST deploy @14 (AKfycbw_6...): the General may update it (`clasp push -f && clasp deploy -i <TEST id>`). Tester
  turns are TEST-labelled and get archived after.
- Supabase p03_turns / p03_turn_settings (shared by both deploys): tester writes TEST turns only.
- automation@ mail: EMAIL_TEST_TO stays matt@; turning it off = Matt only.

## Parts
- **P1 · worker A (UI)**: `app/App.html`, `app/Index.html`. R1, T1, E4, client side of E2 (auto-call after first scope
  submit, record schedule_emailed_at, button relabel), client side of E3 (call one `apiSendMoveOutEmail` on submit-with-
  changes and on Apply; drop the separate alert/conflict calls + alert checkbox). Verify: preview at 1180x820 + 390x844.
- **P2 · worker B (server)**: `app/Code.js`, `app/Describe.js`, `app-test/describe.test.js`. E1, E2 recipients, E3 merged
  builder + `apiSendMoveOutEmail(turnId)` reading applied `impact` or `pending_impact`; old `apiSendMoveOutAlert` removed or made a thin alias.
  Verify: describe tests assert recipients + merged text.
- **P3 · worker C (tester)** after P1+P2 merge and the TEST deploy: checks every criterion against the local preview + the
  TEST deploy (emails land in Matt's inbox with [TEST]); then adds a round-7 section to TEST_SCRIPT.md for Matt
  (phone + iPad), on top of the pending round-6 items.

## Out of scope
- Anything to vendors/techs (texts, booking), RingCentral, AppFolio writes, Turn Board mock, Eastpointe PDF, the
  other UNDONE items from the 2026-11-11 handoff (they stay queued).

## Decision log
- 2026-11-11 Emails go only to Matt / Jason / Spencer; techs + vendors get nothing; Jason schedules by hand (Matt).
- 2026-11-11 Tech Prep email -> Jason + Spencer only (Matt).
- 2026-11-11 Schedule email auto on first Scope submit -> Jason + Spencer; this is Jason's pre-move-out booking email (Matt).
- 2026-11-11 Post-move-out: one merged email (change + not-applied + conflict review) to Jason + Spencer, cc Matt (Matt).
- 2026-11-11 Remove vendor message buttons AND the re-contact list (Matt).
- 2026-11-11 Room closes only when complete, no auto-advance; Tech Prep is the only room form (Matt).
- 2026-11-11 iPad landscape, rooms list + items side by side; all three forms tablet-designed (Matt).
- 2026-11-11 Ship = one combined test pass (round 6 + this), then LIVE with Matt's OK (Matt).

- 2026-11-11 Move-out email still sends if other open turns can't be read; the section then says why (General).
- 2026-11-11 Server P2 done (worker B, 3d8b6e0): describe 23 + engine 17 pass; awaiting tester.

- 2026-11-11 Eastpointe order text moves into the schedule email (its only way out was the removed vendor message) (General).
- 2026-11-11 UI P1 merged (cc43a50); TEST deploy updated to @15; LIVE @3 untouched. Tester started.
## Noticed (not done)
- Settings "Vendor message template" editor + E.vendorMessage + settings.template are now unused (keep or remove?).
- Wide desktop browsers (>900px) also get the iPad layout; the iPad room list isn't pinned (scrolls away on long rooms).
- Turns created before run 2 have no schedule_emailed_at: their next Scope submit sends the schedule email once.
- Move-out preview/Apply confirm still say "re-contact" (warnings only). README, Config.html vendor-book comment and
  the PLAN R4 notes still describe tech routing / the separate conflict email.
