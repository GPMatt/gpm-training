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

## Noticed (not done)
- 2340 Michael, 2935 Oak Valley, 2700 Clyde Park were taken off the cookie-cutter list on 11/6
  ("now Riley walks"). Bill's rule now makes them Spencer-alone again. Bill's rule wins in this plan.
