# P03 Turn app: manual test on the TEST deployment (Matt, round 6 = round 5 fixes + V1)

Open ON YOUR PHONE: https://script.google.com/a/macros/greenpropertymgt.com/s/AKfycbw_6vLB-pWRR4JIQunwFFmSrgxhVC-nt25LfT9qNszKtJ2LtiYPodAAUWg4btpODJU8mA/exec
EMAIL_TEST_TO = matt@ is set: every email comes only to you, subject starts with `[TEST]`, first line names the real recipients.

This deployment uses the LIVE tables + automation@'s calendar: archive the TEST turns HERE at the end (step 12).
"TEST" goes in the **Unit Turn WO #** box. Use move-out = today.

**Phone layout (V1)**
1. **New turn, Wesley property.** + New turn, `547 Cherry St SE`. *See:* NO timer anywhere; one field per row, no
   sideways scrolling, tapping a box does not zoom the page. Trades: Paint, Clean, Carpet cleaning picked; "Not needed"
   trades show no note box; picking a size on Tub makes its note box appear. *Round 5:* Pre-clean is NOT a trade, it is
   a Type under "Other vendors". Damages: + Add damage → it is a card (Damage / Room / Charge tenant), not a table row.
   "Hole in hall wall", Hall, Charge tenant. WO # `TEST`, move-out today, Tech Basic. **Create turn + build schedule**.
2. **Turn header on a form tab.** Open the Tech Prep tab. *See:* the header shrinks to unit + tabs and stays stuck at
   the top while you scroll; no green rent-ready bar over the Submit button (it shows on Schedule only).
3. **Checklist (V1).** *See:* Filled by = Wesley. Each line = name with ✎ on the right, then 4 equal buttons
   OK / Fix / Not checked / N/A. Exterior ends with **Porch light**. Footer shows "0 / N answered · 0 fix" and updates
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
