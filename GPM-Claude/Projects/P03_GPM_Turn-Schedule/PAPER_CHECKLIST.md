# Current paper turn checklist (on file 2026-11-09)

Jason's "TURN checklist 2026", printed and filled by hand. Example: Spencer, 2361 #4, 11/09/26.
Photos: `input/paper-checklist/2026-11-09_2361-4_page1.jpg` + `_page2.jpg`.

## 1. Transcription (blank form)

Header: Property Address · Tech · Date. Each line has a small answer label + YES - NO.

| Room | Items (answer label) |
|---|---|
| Exterior | Garage opener (Repair needed) · 1 remote per door (Replaced) · Garage service door (Repair needed) · 2 GPM entry keys (# keys left in unit) · Garage or storage room for items left behind (YES-NO) |
| Entry | Mailbox key (# keys left in unit) · Entry lock (Replaced / Re-keyed) · 2 key min (# keys left in unit) · Door latches · Hallway light · Closet door/shelves (Repair needed) |
| Living room | Window panes · Window screens · Window locks · Window blinds · Outlets have power · Outlet/switch covers · Light fixture · HVAC vents for replacement/paint · Thermostat (Heat) - A/C · Smoke/CO2, outside bedroom (Missing/Replace) |
| Basement | Smoke detector · Furnace filter (Replaced; fine print: add the size to "Furnace Filter Sizes" in Google) · Washer, Dryer, Utility sink (None / Repair needed) · Lights |
| Kitchen | Light above sink · Run dishwasher · Disposal · Faucet · Drains under sink · Stove/oven · Drip pans · Hood filter · Microwave · Fridge/freezer · Countertops · Cabinets/drawers · GFCI protecting · Outlet/switch covers |
| Bathroom (1), (2) | Light/vent fan · Tub faucet · Tub drain · Tub stopper · Shower caulk · Shower curtain · Shower bar · Toilet drain/fill · Bolt cap on toilet · Toilet seat/hinges · Vanity faucet · Vanity drain · Toilet paper bars · Towel bar · GFCI protecting · Outlet/switch covers |
| Bedroom (#1)-(#4) | Door latches · Window panes · Window screens · Window locks · Window blinds · Outlets have power · Outlet/switch covers · Light fixture · Smoke detector (Missing/Replace) · Closet door latches · Closet hardware |
| Notes | blank lines |

What Spencer wrote by hand on 2361 #4 (these show where the form falls short):
- Exterior and Basement crossed out entirely (the unit has neither).
- "1 MAIL" beside Mailbox key (key count).
- Kitchen: "CABINETS STAY OPEN" (the cabinets don't stay shut).
- Bedrooms 1 + 2: "CHARGE TENANT" beside Window blinds.
- Bottom of page 1: "BATHROOM COUNTERTOPS / SINK CAULK", "TOUCH UP PAINT".
- Bathroom 2, Bedrooms 3-4 blank (2-bed, 1-bath unit).

## 2. Differences: paper vs the app's Tech Prep form (app/Config.html, deploy @3)

**Same in both.** Every room and item matches line for line (checked 11/6). The app repeats the
Bathroom and Bedroom blocks by the counts entered, so the blank Bath 2 / Bed 3-4 pages go away.

**The app handles these better:**
| Paper | App |
|---|---|
| Cross out a room, or "None" | N/A per item |
| YES/NO, polarity unclear (see below) | OK / Fix / Not checked / N/A on every line |
| "# keys left" written in the margin | Number fields: entry keys, mailbox keys, garage remotes, other keys |
| Entry lock Replaced / Re-keyed | Entry lock: OK / Re-key / Replace + lock type + parts |
| Furnace filter fine print | Furnace filter size field |
| Nothing for this | Tech hours estimate, parts list (qty + store), tools, blinds count + sizes, items left behind, "not checked" items shown at move-out |

**Paper has it, the app doesn't (gaps):**
1. **Charge tenant on a single line.** Spencer tagged blinds twice. In the app, charge tags exist
   only in the Scope form's damages list, a separate screen.
2. **A note on a line that is NOT a Fix.** The app opens a note box only on Fix / Not checked.
   "Cabinets stay open" fits Fix, but nothing tells him that.
3. **Items that aren't on the list:** bathroom countertop and sink caulk were written in by hand.
4. **Touch-up paint** was written on the tech sheet, but paint size belongs to Scope (Spencer's
   trade call). The app keeps them on separate forms, so it can get lost the same way.

**A problem with the paper itself.** Every line is labeled "Repair needed: YES / NO", but many items
are worded as a pass test ("Outlets have power", "Run dishwasher", "GFCI protecting"). So does a
circled YES mean "works" or "needs repair"? On the 2361 #4 sheet YES is circled on both kinds of
line, and I can't tell from the photo which he meant. The app's OK / Fix fixes this.

## 3. Suggested checklist (keeps every paper item)

Rules:
- One scale on every line: **OK · Fix · N/A · Not checked**. Fix opens "what / part needed" and a
  **Charge tenant** toggle. Tagged lines copy into the turn's damages list, so Spencer's deposit
  view has them without typing them twice.
- An optional note on ANY line (small pencil icon), not only on Fix.
- Rooms that may not exist (Exterior/garage, Basement, Laundry) start with a **"Unit has this? Y/N"**
  switch. No = the whole block is N/A in one tap (same as the cross-out today).
- Bedrooms 0-5 and bathrooms 1-3 set how many blocks repeat (paper caps at 4 and 2).
- Counts stay as number fields (keys, mailbox keys, remotes, blinds per room).

Items. Paper items are unchanged. **Bold = suggested additions**:

| Room | Items |
|---|---|
| Exterior / garage (Y/N) | Garage opener · 1 remote per door (count) · Garage service door · Garage/storage room clear of items left behind · **Exterior / porch light** |
| Entry | Entry lock (OK / Re-key / Replace) · 2 GPM entry keys min (count) · Mailbox key (count) · Door latches · **Deadbolt + door closes/seals** · Hallway light · Closet door/shelves · **Hallway smoke detector** |
| Living room | Window panes · screens · locks · blinds (**count + size if Fix**) · Outlets have power · Outlet/switch covers · Light fixture · HVAC vents (replace/paint) · Thermostat (heat + A/C) · Smoke/CO, outside bedroom |
| Kitchen | Light above sink · Run dishwasher · Disposal · Faucet · Drains under sink · **Sink caulk / backsplash** · Stove/oven · Drip pans · Hood filter **+ hood light/fan** · Microwave · Fridge/freezer · Countertops · Cabinets/drawers (**doors stay shut, hinges**) · GFCI protecting · Outlet/switch covers |
| Laundry (Y/N, wherever it is) | Washer · Dryer **+ dryer vent** · Utility sink |
| Basement / utility (Y/N) | Smoke detector · Furnace filter (Replaced + size) · Lights · **Water heater: leaks / age (flag only; replacement = "other vendor" on Scope)** |
| Bathroom (x count) | Light/vent fan · Tub faucet · Tub drain · Tub stopper · Shower caulk · Shower curtain · Shower bar · Toilet drain/fill · Bolt caps · Toilet seat/hinges · Vanity faucet · Vanity drain · **Vanity countertop** · **Sink caulk** · **Mirror / medicine cabinet** · Toilet paper bar · Towel bar · GFCI protecting · Outlet/switch covers |
| Bedroom (x count) | Door latches · Window panes · screens · locks · blinds (**count + size if Fix**) · Outlets have power · Outlet/switch covers · Light fixture · Smoke detector · Closet door latches · Closet hardware |
| Notes | Free text for Jason |

The laundry block moves washer/dryer out of Basement: apartments have laundry closets, not basements.

Stays OFF the tech checklist (it's Spencer's Scope form): paint size (touch-up / full), flooring,
tub, drywall, cleaning level, appliance replace (make + model). Optional: a Fix note that says
"paint" shows Spencer a nudge on the Scope form.

## 4. Open for Spencer + Jason
- Confirm the additions in bold (anything missing that they check by habit?).
- Charge tenant on the tech sheet: OK for Riley to tag, or Spencer only (he's the damages owner)?
  Suggestion: anyone can tag, Spencer confirms at move-out.
- Is CO required in every unit, or only units with gas appliances? (Paper says "Smoke/CO2".)
