# P03 Turn app: manual test on the TEST deployment (Matt, round 4)

Open: https://script.google.com/a/macros/greenpropertymgt.com/s/AKfycbw_6vLB-pWRR4JIQunwFFmSrgxhVC-nt25LfT9qNszKtJ2LtiYPodAAUWg4btpODJU8mA/exec
(phone if you can). EMAIL_TEST_TO = matt@ is set: every email comes only to you, the subject starts with `[TEST]`,
and the first line names the real recipients.

Before you start: this deployment uses the LIVE tables and the account that deployed it writes the calendar
events, so Spencer sees these turns until step 13. Archive them HERE (not in the live app: the live app doesn't
delete calendar events yet). The Unit box is a dropdown, so "TEST" goes in the **Unit Turn WO #** box.
Use move-out = today. Keep the calendar of the deploying account (automation@) open in another tab.

1. **New turn, Wesley property.** + New turn, pick `547 Cherry St SE`. *See:* walk type "Wesley walk (Spencer +
   Wesley)"; Paint, Clean AND **Carpet cleaning** already selected. Tap **Start timer**, reload the page, open
   + New turn again: the clock is still running. WO #: `TEST`, move-out today, also pick Tech Basic.
   Damages: + Add damage "Hole in hall wall", room "Hall", tick Charge tenant. Button reads **Submit + end timer**: tap it.
   *See:* gantt right away; Tech step vendor **Wesley**; header "PMI 0.x h".
2. **Calendar.** *See (within a minute) in the calendar:* one event per step, e.g. "Paint · Trevor · 547 Cherry
   St SE [Not booked]" at 9 AM, plus an all-day "Rent ready · 547 Cherry St SE". Then mark **Paint** and **Clean**
   Confirmed on the turn. *See:* those two titles lose "[Not booked]" after a refresh.
3. **Tech Prep (Wesley).** Tech Prep tab. *See:* Filled by = Wesley, no timer. Open Kitchen, tap **OK** on two
   lines: the room stays open. Mark "Disposal" **Fix**, Charge tenant, note "Disposal jammed". Mark a Bedroom 2
   line Fix, then set Bedrooms to 1. *See:* "Bedroom 2 has 1 answer… Remove them / Keep 2 bedrooms": tap **Keep**.
   + Add blind twice: Bedroom 1, "left of bed", 35x64; Living room, 23x64. Entry keys 1, tick Charge tenant for
   missing keys. Hours 4. **Submit**.
   *See:* toast "Email sent to matt@…"; email first line names spencer@ + **wesley@**, Cc jason@; body has
   "Kitchen: Disposal jammed. (Charge Tenant)", a Keys line with (Charge Tenant), and under Parts to order
   "Blinds to replace: 2" with both rows (room, window, size).
4. **No double send + Resend.** Hours 5, **Save changes**: no email. **Resend email**: one more arrives.
5. **New turn, Bill property.** + New turn, pick `2935 Oak Valley Ave SW`. *See:* "Bill's property (Spencer
   alone)". Start timer: the button says "Create turn + build schedule". WO # `TEST`, move-out today, Tech Basic. Create.
   *See:* Tech vendor **Bill**.
6. **Bill Tech Prep.** *See:* clock still running, Filled by = Spencer (Bill isn't in the list), button **Submit +
   end timer**. Hours 2, one Fix line, submit. *See:* email names spencer@ + bill@, no "Riley" anywhere; header "PMI x h".
7. **Move-out blocked.** Cherry turn → Move-out check → **Submit** with nothing filled. *See:* "Before you can
   submit" lists the scope question, Keys received, and "Final tenant damages: mark Charge or Don't charge on 3 items".
   The damages list shows 3 carried-in rows: Scope "Hole in hall wall", Tech Prep "Disposal: Disposal jammed", Keys.
8. **Damages.** Mark the 3 rows Charge / Don't charge / Charge. + Add damage "Broken closet door", mark Charge.
   Leave the tab and come back. *See:* still 4 rows, no duplicates, your choices kept.
9. **Move-out No + preview.** Scope matches = **No**, + Add a change: Add a trade, Tub, Resurface. *See:* rent
   ready old → new, move-in buffer, "Paint / Clean confirmed: re-contact".
10. **Submit without Apply.** Tick Keys received, keep "Email an alert" ticked, **Submit**. *See:* email
    `[TEST] Turn scope changed, NOT applied: …` PLUS a second email `[TEST] Turn conflict review: 547 Cherry St SE`
    (moved vendors + "Same vendors on other open turns"); red "Scope changed, not applied" banner on the turn and its
    board card; dates unchanged.
11. **Apply.** **Apply now** on the board card → **Apply to schedule** → OK. *See:* `[TEST] Turn schedule changed: …`
    and another conflict review email; Paint/Clean red "Reschedule"; "Schedule conflicted: 2 vendors to re-contact"
    with the re-contact list; not-applied banner gone. In the calendar, Paint/Clean move to the new days, marked
    "[Reschedule]", and a Tub event appears.
12. **Clear + undo.** **Confirmed new date** on both: banner disappears. Move-out tab → **Edit changes** → OK.
    *See:* dates and Confirmed statuses back to before Apply, the not-applied banner returns, the calendar moves back
    (no email).
13. **Clean up.** Each TEST turn: Schedule tab → **Archive** → OK. *See:* both leave the board AND all their events
    leave the calendar. Expected emails: 2 Tech Prep (Cherry) + 1 (Oak Valley) + 1 alert + 1 change + 2 conflict
    reviews = 7. Tell the general what arrived and anything that looked wrong.
