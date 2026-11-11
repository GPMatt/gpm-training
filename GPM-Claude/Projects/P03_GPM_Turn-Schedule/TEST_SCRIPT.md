# P03 Turn app: manual test on the TEST deployment (Matt, round 7 = run 2, plus round 6 additions)

TEST link = https://script.google.com/a/macros/greenpropertymgt.com/s/AKfycbw_6vLB-pWRR4JIQunwFFmSrgxhVC-nt25LfT9qNszKtJ2LtiYPodAAUWg4btpODJU8mA/exec (deploy @15).
Use TEST-labelled turns only ("TEST" in the **Unit Turn WO #** box) and archive them after (last step).

EMAIL_TEST_TO = matt@ is set: every email comes ONLY to you, subject starts with `[TEST]`, and the first line says
"TEST: real recipients would be To: ...". That line is how you check who it would really have gone to.
This deployment uses the LIVE tables + automation@'s calendar. Phone first, then the same on the iPad held sideways.

## Round 6 additions (phone)

- [ ] 1. **Titles.** Board + turn header show the property NAME on top (e.g. "Oak Valley Apartments"), then a unit
  line ("Unit 204" / "Building 2827 · Unit 301"); a house shows no unit line. The address is the small grey line.
- [ ] 2. **Damages carry-over.** Open Victory on Leonard #108 → Move-out tab. *See:* "Window broken" is in **Final
  tenant damages**. Look only, don't submit (it is a real turn).
- [ ] 3. **Tub overnight.** On a TEST turn, Scope → Tub = Resurface (sits overnight). *See:* Tub is 1 day, the next
  step starts the next business day (no cure day in between).
- [ ] 4. **Paint Redo trim.** Scope → Paint = Redo trim. *See:* Paint bar is 2 days.
- [ ] 5. **Eastpointe questions.** Scope → Flooring = Not needed: no Eastpointe questions. Flooring = LVP, then
  carpet, then both: the "Flooring order" questions appear (carpet ones for carpet/both, vinyl ones for LVP/both).
  Save. *See:* Schedule shows "measure <date>" on Flooring = 1 week before install; calendar has a "Flooring
  measure" event. The schedule email (Round 7 step 3) has an "Eastpointe order (Flooring):" block.
- [ ] 6. **Tech self-correct, 2340 Michael.** Open the existing 2340 Michael Ave SW turn (the old version made it
  Cookie cutter + Riley); look only. If there is none, make a TEST one. *See:* walk type = "Bill's property (Spencer
  alone)", the not-yet-confirmed Tech step vendor = **Bill** (not Riley).
- [ ] 7. **Holidays.** A TEST turn with move-out Mon Nov 23 2026: no step lands on Thu Nov 26 (Thanksgiving) or the
  weekend; Calendar tab greys Nov 26.

## Round 7 (run 2): emails, room close, iPad, no vendor messaging

Phone = your phone. iPad = iPad held sideways (landscape). Do each step on the phone; the **iPad** lines say what to
check again on the iPad.

**Tech Prep email goes to Jason + Spencer only (E1)**
- [ ] 1. New TEST turn at a **Bill** property (`2860 Taft Ave SW` or `3608 Havana Ave SW`). Tech Prep: hours 2, one
  Fix, **Submit**. *Inbox:* one `[TEST] Turn WO description: ...`; first line "real recipients would be To:
  jason@greenpropertymgt.com, spencer@greenpropertymgt.com" (no Cc, no bill@ / riley@ / wesley@ anywhere).
  Body is the same as before (room lines, Keys, Parts to order).
- [ ] 2. Same on a **Wesley** TEST turn (`547 Cherry St SE`). Then **Save changes**: no email. **Resend email**: one
  more, same recipients.

**Schedule email on the first Scope submit (E2)**
- [ ] 3. **New turn:** + New turn (TEST, Flooring = LVP, answer the Eastpointe questions), Create. *Inbox:* one
  `[TEST] Turn schedule: <address> <unit>`, real recipients Jason + Spencer, no Cc. It has the steps and an
  "Eastpointe order (Flooring):" block.
- [ ] 4. Scope tab → change something → **Save scope + update schedule**. *Inbox:* nothing new.
- [ ] 5. **Existing turn:** a TEST turn made BEFORE today's deploy (or the Bill turn from step 1 if it was made on
  @15, then skip): first Scope save sends one schedule email, the next does not. A turn with no Eastpointe flooring:
  no "Eastpointe order" block.
- [ ] 6. Schedule tab → **✉ Email schedule to Jason + Spencer**. *Inbox:* one more schedule email.

**One move-out email (E3)**
- [ ] 7. TEST turn with Paint set to **Confirmed** (and Tech confirmed for Bill or Wesley). Move-out tab: answer
  everything, Scope matches = **Yes**, Submit. *Inbox:* nothing.
- [ ] 8. Scope matches = **No**, + Add a change: Change a size, Paint → New home (moves Paint). Submit WITHOUT Apply.
  *Inbox:* ONE `[TEST] Turn scope changed, NOT applied: ...`: says "NOT been updated yet ... tap Apply", "If applied,
  rent ready would move from X to Y", the change, "Confirmed vendors whose date would move" (Paint - Trevor; a moved
  tech is named too), "Same vendors on other open turns (within 15 business days)" (a list or "None found"). First line:
  real recipients To Jason + Spencer; **Cc: matt@greenpropertymgt.com**. Red "Scope changed, not applied" banner.
- [ ] 9. Submit again: no second email.
- [ ] 10. **Apply now → Apply to schedule.** *Inbox:* ONE `[TEST] Turn schedule changed: ...` ("the schedule has been
  updated", "Rent ready moves from X to Y", confirmed vendors whose date moved, other dates that moved, same vendors
  on other turns). NO separate "conflict review" email.

**No vendor messaging (E4)**
- [ ] 11. Schedule tab after Apply. *See:* Paint is red **Reschedule**, banner "⚠ Schedule conflicted: 1 step to
  reschedule". NO "Vendor message" button, no "Vendors to re-contact" list, no "Message with new date", no "See who".
  AppFolio WO copy button + Resend are still there.
- [ ] 12. Tap Paint's **Confirmed**: the banner goes away. (Or Move-out → Edit changes → OK: banner gone too.)

**Room close on the phone (R1)**
- [ ] 13. Tech Prep, Kitchen: tap OK, then N/A on two lines. *See:* Kitchen stays open. Fold Basement by hand.
- [ ] 14. Answer every other Kitchen line (mix OK / Fix / Not checked / N/A). *See:* Kitchen folds ONLY on the last
  one, shows ✓; Basement stays folded (the next room does not open by itself).
- [ ] 15. Open Kitchen again. **Save draft**; switch to Schedule and back; ← Turns and reopen this turn. *See:* Kitchen
  still open, Basement still folded, every unfinished room still open.
- [ ] 16. Entry: **Mark the other N OK + next room**. *See:* Entry folds, Living room opens.

**iPad sideways (T1)**
- [ ] 17. Tech Prep. *See:* room list on the left (each with answered/total, fix count, ✓ when done; the selected room
  highlighted), the room's lines on the right. Tap a room: it shows. Finish a room: it stays selected, gets ✓.
- [ ] 18. Scope and Move-out: simple fields in two columns. Every button and box is easy to tap. No sideways scroll on
  any tab (also turn the iPad upright: still no sideways scroll; phone layout unchanged).
- [ ] 19. Repeat steps 8-12 on the iPad with a second TEST turn: same emails, same banners.

**Clean up**
- [ ] 20. Archive every TEST turn HERE: they leave the board and the calendar.

Tell me what arrived and anything that looked wrong. Pass = Matt deploys @15's code to the live URL (EMAIL_TEST_TO
stays on).

## Round 6 base (earlier, kept for reference)

Run 2 changed: step 4 (Tech Prep email now To Jason + Spencer only), step 6 (no bill@), step 8 (Vendor message is
gone), step 10 (one NOT applied email, no conflict review) and step 11 (no re-contact list). Use Round 7 for those.

**Phone layout (V1)**
1. **New turn, Wesley property.** + New turn, `547 Cherry St SE`. *See:* NO timer anywhere; one field per row, no
   sideways scrolling, tapping a box does not zoom the page. Trades: Paint, Clean, Carpet cleaning picked; "Not needed"
   trades show no note box; picking a size on Tub makes its note box appear. *Round 5:* Pre-clean is NOT a trade, it is
   a Type under "Other vendors". Damages: + Add damage → it is a card (Damage / Room / Charge tenant), not a table row.
   "Hole in hall wall", Hall, Charge tenant. WO # `TEST`, move-out today, Tech Basic. **Create turn + build schedule**.
2. **Turn header on a form tab.** Open the Tech Prep tab. *See:* one slim top row; the header shrinks to unit + tabs and scrolls away (nothing pinned) at
   the top; Submit / Save buttons are at the END of the form, not pinned; no green rent-ready bar on form tabs.
   *Holidays:* Calendar shows only New Year's, Memorial, July 4, Labor, Thanksgiving, Christmas (no Veterans Day today).
3. **Checklist (V1).** *See:* Filled by = Wesley. Each line = name with ✎ on the right, then 4 equal buttons
   OK / Fix / Not checked / N/A. Exterior ends with **Porch light**. The count above the buttons at the end of the form shows "0 / N answered · 0 fix" and updates
   as you tap. Kitchen: tap OK on 2 lines (room stays open, round 5), Fix "Disposal" + Charge tenant + note "Disposal
   jammed". Tap **Mark the other N OK + next room**: Kitchen closes with ✓ and green, the next room opens.
   *Round 5:* Rooms chips: tap Basement off → it leaves the list (asks first if it has answers).
   Set Bedrooms lower than a bedroom you answered → "Remove them / Keep" prompt → **Keep**.
4. **Blinds + keys.** + Add blind twice (cards): Bedroom 1, "left of bed", 35x64; Living room, 23x64. Entry keys 1,
   Charge tenant for missing keys. Hours 4. **Submit**. *See:* toast "Email sent to matt@…"; email names spencer@ +
   wesley@, Cc jason@; "Kitchen: Disposal jammed. (Charge Tenant)", a Keys line, blinds under Parts to order.
5. **WO description copy (V1).** Tap **⧉ AppFolio WO description** (Tech Prep footer). *See:* popup with the room
   lines + Keys line ONLY (no parts, no "Not for the work order"). **Copy for AppFolio WO**, paste into Notes: matches.
   Same button on the Schedule tab's "Before move-out" panel. Edit hours, don't save, tap the button: "Save your
   changes first". Save changes: no email. **Resend email**: one more arrives.
6. **Bill property.** + New turn, `2935 Oak Valley Ave SW`. *See:* "Bill's property (Spencer alone)"; Tech vendor
   **Bill**. Tech Prep: Filled by = Spencer, button just "Submit". Hours 2, one Fix, submit: email to spencer@ + bill@,
   no "Riley" anywhere.

**Vendor book (V1)**

7. **Settings → Vendor book.** *See:* cards with Company / Trade / Contact name / Email / Cell, seeded with our vendors
   (Eastpointe has Tom Rozanski + 616-272-7120; Riley, Bill, Wesley under Tech). Set Trevor's cell to your cell,
   + Add vendor "TEST Painter", trade Paint. **Save settings**, reload: both kept.
8. **Vendor book in use.** Cherry turn → Schedule → Paint step: tap the Vendor box: Trevor + TEST Painter suggested
   first. **✉ Vendor message** on Paint: starts "Hi Trevor," and has a **Text <your cell>** button that opens Messages
   with the text filled in. Then delete TEST Painter in Settings + Save.

**Move-out (round 4/5 flow, now on a phone)**

9. **Blocked + damages.** Cherry → Move-out check → **Submit** empty. *See:* the red list; 3 carried-in damage rows
   (Scope hall wall, Tech Prep disposal, Keys). *Round 5:* NO "Does the rent-ready date still hold?" question.
   Mark them Charge / Don't charge / Charge (two big buttons each), + Add damage "Broken closet door", Charge.
10. **No + submit without Apply.** Scope matches = No, + Add a change: Add a trade, Tub, Resurface (preview shows rent
    ready old → new, "Paint / Clean confirmed: re-contact" if you confirmed them). Keys received, Submit.
    *See:* `[TEST] Turn scope changed, NOT applied` + `[TEST] Turn conflict review` (only if a confirmed vendor moved);
    red "not applied" banner.
11. **Apply + calendar.** Apply now → Apply to schedule. *See:* `[TEST] Turn schedule changed`; re-contact list shows
    each vendor's phone/email FROM THE VENDOR BOOK. Calendar (automation@): one event per step, rent ready ONLY on its
    own all-day event (round 5). Edit changes → OK: everything back.
12. **Clean up.** Archive both TEST turns HERE: they leave the board and the calendar.

Tell me what arrived and anything that looked wrong. When it passes, I deploy it to the live URL (EMAIL_TEST_TO stays on).
