# P03 Turn app: manual test on the TEST deployment (Matt)

Open: https://script.google.com/a/macros/greenpropertymgt.com/s/AKfycbw_6vLB-pWRR4JIQunwFFmSrgxhVC-nt25LfT9qNszKtJ2LtiYPodAAUWg4btpODJU8mA/exec
(use your phone if you can). EMAIL_TEST_TO = matt@ is set, so every email comes only to you, subject starts
with `[TEST]`, and the first line names the real recipients.

Before you start: this deployment uses the LIVE tables, so Spencer sees these turns on his board until step 12.
The Unit box is a dropdown (no free text), so "TEST" goes in the **Unit Turn WO #** box. Use move-out = today.

1. **New turn, Riley property.** + New turn. Property: start typing `547 Cherry` and pick it. Walk type fills
   itself as "Riley walk". Tap **Start timer**: the clock ticks. Pull down to reload the page, open + New turn
   again: the clock is still running. Unit: Whole property. WO #: `TEST`. Move-out: today. Trades: Tech Basic,
   Paint Full, Clean Standard. The button reads **Submit + end timer**: tap it.
   *See:* the schedule with the gantt bars right away; the header shows "PMI 0.x h".
2. **Confirm two steps.** On that turn, mark **Paint** and **Clean** "Confirmed".
3. **Tech Prep, first submit.** Tech Prep tab. Filled by = Riley. Hours: 4. Mark Kitchen "Disposal" **Fix**,
   tap **Charge tenant**, note "Disposal jammed". Mark one Bedroom line **Not checked**, note "Boxes".
   Entry keys: 1, tick "Charge tenant for missing keys". Tap **Submit**.
   *See:* toast "Email sent to matt@…". Email `[TEST] Turn WO description: 547 Cherry St SE (WO TEST)`:
   "Kitchen: Disposal jammed. (Charge Tenant)", a Keys line with "(Charge Tenant)", then below the divider
   the Not checked item, Tech hours 4, Filled by Riley.
4. **No double send + Resend.** Change hours to 5, tap **Save changes**: NO new email. Tap **Resend email**:
   one more identical email arrives.
5. **New turn, Bill property.** + New turn, pick `2935 Oak Valley Ave SW`. *See:* walk type =
   "Bill's property (Spencer alone)". Tap **Start timer**; the button says "Create turn + build schedule"
   (not "end timer"). WO #: `TEST`, move-out today, Trades: Tech Basic + Clean. Create.
   *See:* the Tech step vendor is **Bill**.
6. **Bill Tech Prep ends the timer.** Tech Prep tab: the clock is still running, Filled by = Spencer, the
   button reads **Submit + end timer**. Hours 2, mark one line Fix, submit.
   *See:* the header shows "PMI x h"; an email with "real recipients would be To: spencer@…, bill@…; Cc: jason@…"
   and no mention of Riley anywhere.
7. **Move-out blocked.** Back on the Cherry turn: Move-out check tab, tap **Submit** with nothing filled.
   *See:* a list "Before you can submit": answer the scope question, answer 1 not-checked item, tick Keys received.
8. **Move-out No + preview.** Scope matches = **No**, + Add a change: "Add a trade", Tub, Resurface.
   *See:* a live preview: rent ready old → new, move-in buffer, and "Paint / Clean confirmed: re-contact".
9. **Submit without Apply (alert).** Answer the not-checked item, tick Keys received, leave "Email an alert"
   ticked, tap **Submit** (not Apply).
   *See:* email `[TEST] Turn scope changed, NOT applied: 547 Cherry St SE …`; a red "Scope changed, not applied
   to schedule" banner on the turn AND on its board card; schedule dates unchanged.
10. **Apply.** Tap **Apply now** on the board card, then **Apply to schedule**, OK.
    *See:* email `[TEST] Turn schedule changed: …` (changes, moved dates, old → new rent ready); Paint/Clean turn
    red "Reschedule"; red "Schedule conflicted: 2 vendors to re-contact" on turn + board; the re-contact list
    shows Trevor / GR Cleaning with phone/email or "not set. Add in Settings"; the not-applied banner is gone.
11. **Clear + undo.** Tap **Confirmed new date** on both: the conflicted banner disappears. Then Move-out tab →
    **Edit changes** → OK. *See:* dates and Confirmed statuses go back to before Apply, the not-applied banner
    returns. (No email for Undo.)
12. **Clean up.** On each TEST turn: Schedule tab → **Archive** → OK. *See:* both leave the board. Tell the general
    which emails arrived (expected: 2 Tech Prep for Cherry, 1 for Oak Valley, 1 alert, 1 change email = 5).
