# P15 Jotform backup — Owner Intake forms

Pulled from Jotform on 2026-10-08. Question titles only: field types, answer
options and conditional logic are not included (the connector doesn't return
them), so this is enough to rebuild the forms by hand, not to restore them.

## v2 "one size fits all" form — 2026-10-08

- Form ID: 262804649990066
- URL: https://form.jotform.com/262804649990066
- Title: GPM New Client Onboarding — Owner Intake v2
- Sent AFTER the management agreement is signed (contract goes out by
  DocuSign first), so the closing text no longer promises an agreement.
- Changes from the rebuild below, all agreed with Matt on 2026-10-08:
  - Occupancy asked once (in The Property); it drives the tenant section and
    the vacancy-dependent leasing questions.
  - SSN shown to individuals, EIN / Tax ID shown to entities.
  - Utilities: checklist of which utilities serve the property, then "who
    gets the bill" only for those checked.
  - Security deposit account: "Not applicable — I don't have a separate
    security deposit account" option.
  - Tenants: add-a-row table (one row per tenant). 1 unit goes straight to
    the table; 2+ units choose between uploading a rent roll and the table.
  - New optional Unit Details section: add-a-row table (unit, beds, baths,
    sq ft, amenities) or spreadsheet upload for many units.
  - "Any…?" questions are Yes/No with a details box on Yes (deferred
    maintenance, major projects, code violations, payment plans, notices,
    concessions, warranties).
  - Vendors: checklist of services in place, provider field per checked
    service; contracts questions hidden when none. Elevator/fire/security
    question only for 2+ units. HOA gated by Yes/No.
  - No mortgage skips lender, mortgage-payment and escrow questions.
  - "Appliances supplied by owner" sits under Physical Property.
  - Added "Any details about the property that would be helpful for future
    tenants?"; photo ID upload says a clear photo is necessary.
  - Operating voided check stays optional. Photo ID stays last.
- Second round of changes, agreed with Matt later on 2026-10-08:
  - Utilities Today is now one grid, "Who pays for each of these at the
    property?": rows Gas, Electric, Water, Trash, Lawn care, Snow removal;
    choices Landlord / Tenant / Not applicable. No utility company names.
    GPM never puts utilities in its own name, so "Once we take over, where
    should these utility accounts live?" is gone.
  - Removed as duplicates of the grid: lawn, snow and trash provider
    questions (and their checklist options) in Vendors, and "Utilities
    included in rent, if any" in Leasing.
  - Security deposit account is optional: new Yes/No "Do you have a separate
    security deposit account?" gates the whole block (replaces the "Not
    applicable" option). On Yes the owner still chooses between uploading a
    voided check / bank letter and typing account + routing numbers.
  - Both authorized-signer questions: the No answer reads "No — I will order
    a signature stamp from Amazon for GPM to use instead", with helper text
    saying a stamp must be ordered.
  - Tenant questions show only when prior management is Self-managed AND the
    property is occupied (Yes or Some units occupied). Newly purchased
    occupied properties deliberately see no tenant questions. The connector
    could not put a condition on the "Existing Tenant Information" heading,
    so the heading itself may still show with nothing under it.
- Third round, agreed with Matt on 2026-10-08:
  - Mortgage question reworded to "Are you interested in having GPM pay the
    mortgage on your behalf?" (Yes — I'd like to discuss it / No — I'll keep
    paying it myself); GPM does not take over mortgage payments for everyone.
  - Prior management = "Another property management company" reveals three
    required fields: previous management company name, email, phone number.
  - Lawn care and Snow removal are back as two separate options in "Which of
    these services are in place today?", each with its own provider
    question. Trash provider stays removed.
- Fourth round, after Matt's first test run on 2026-10-08:
  - "Are there tenants currently living there?" options are now exactly
    Yes / No / Some.
  - Tenants table: the builder reported the rent, deposit and balance
    columns changed to plain text, but they were NOT (still number columns
    that rejected every value). Fixed in the sixth round by replacing the
    table. An added rule hides the table when the owner chooses to upload a
    rent roll.
- Fifth round, after Matt's second test run on 2026-10-08:
  - Added rule hides "Upload rent roll / tenant ledger" when the owner
    chooses "Enter tenants here" (the two were both showing).
  - Security deposit rules repaired: a conflicting rule that hid the typed
    account / routing number fields was deleted. On Yes the owner sees the
    provide-method question, account type and the second signer question;
    the number fields show on "Enter account and routing number".
  - New in The Property, for Alaina's utility set-up (624 Veto emails):
    - "Unit numbers or letters at this address": required, shown when the
      unit count is above 1.
    - "Closing date (the date you took ownership)": required, shown when
      Newly purchased AND occupied (Yes or Some). Closing date was Claude's
      pick; Alaina to confirm the utilities don't want tenant move-in date.
    - "Are any units subsidized (Section 8 or another housing assistance
      program)?" Yes/No, shown when occupied; on Yes: "How many units are
      subsidized?" (required) and optional "Subsidy program and housing
      agency contact, if known".
    - "Is the property tax exempt?" Yes/No, always shown.
- Sixth round, 2026-10-08, from a browser test run by a second Claude
  session (19-item fix plan; Matt dropped items 4 and 9, deferred 16):
  - Both add-a-row tables replaced. The old "Units" and "Tenants" tables
    had number columns whose allowed range was 0 to 0, so any bedroom
    count, rent or deposit blocked submit, and the builder cannot edit an
    existing table. New tables "Unit list" and "Tenant list" use plain text
    columns (dates stay date pickers); the old tables were deleted
    permanently at Matt's choice. Browser-verified: both accept numbers
    and money amounts.
  - "Unit list" shows only when unit details = "Enter here".
  - "Tenant list" has one show rule: Self-managed AND tenants answered and
    not "No" AND tenant-details method is not the rent roll upload. The
    builder could NOT make it required (the old table was).
  - New required question "How do you prefer we contact you?" (Email /
    Phone call / Text message) after Mailing address. Options are Claude's
    pick.
  - Input masks: SSN ###-##-####, EIN ##-####### (both browser-verified).
    EIN is hidden until individual/entity is answered.
  - Deposit routing number is exactly 9 digits; deposit account number is
    digits only, 4 to 17. Unit count is a whole number of at least 1.
  - Uploads limited to pdf, jpg, jpeg, png, heic, 25 MB; rent roll and unit
    spreadsheet uploads also take xls, xlsx, csv.
  - Services checklist: selection cap of 3 removed. Closing date rule
    repaired. "Any upcoming vacancies" shows when tenants = Yes or Some.
  - Moved: subsidized questions to directly under "Are there tenants
    currently living there?"; lawn and snow provider next to the other
    provider fields.
  - Could not be done through the builder: an exclusive "None of these" on
    the services checklist; dollar validation on the two rent fields.
  - Later the same day, after the tester's full rerun (three real test
    submissions went through; phone width clean):
    - Deposit account section opens correctly: Yes shows the method
      question, account type and signer question; the typed numbers or the
      upload appear on the chosen method and are required. The two stale
      "Not applicable" rules and the No/empty hide pair were deleted.
    - Show-on-Yes rules created for the deferred maintenance, major
      project and code violation detail boxes (they had none).
    - Tenant section rebuilt on Matt's approval: one hide rule (not
      Self-managed, or tenants No/unanswered) over the tenant questions,
      with the four detail boxes left to their own Yes rules. The
      "units > 1 shows rent roll" rule is gone. "How would you like to
      provide tenant details?" is now required. The "Existing Tenant
      Information" heading shows for every owner.
    - Custom thank-you page: "Thank you! We've received your information,
      and a member of the Green Property Management team will be in
      touch." (not browser-verified).
    - Orphaned rules pointing at deleted fields were cleaned out.
  - Final tester pass (about 4:00 PM, 113 fields, 62 conditions, no stale
    rules), after Matt deleted the "= No -> hide upload / account number /
    routing number" rule by hand:
    - Real end-to-end submit went through ("CLAUDE TEST D Ignore Me":
      entity, 4 units, self-managed, tenants and units typed in the tables,
      deposit account with typed numbers, 5 services).
    - Thank-you page shows the GPM text. The "Now create your own Jotform"
      ad still shows under it (a plan/branding setting, not a rule).
    - Deposit section: answering Yes now shows only the method question
      until a method is picked. Required checks work.
    - "How will you give tenant details" and "Tenant list" are both
      required now, and neither blocks owners who never see them.
    - Phone width (390px) clean for the deposit and tenant sections.
  - Deposit toggle-back fix (about 4:35 PM, tester-verified, 60 conditions):
    answering Yes, picking a method, then switching to No used to leave the
    method fields on screen, and with "enter numbers" left empty it blocked
    submit. Now switching to No hides everything and submits. The five
    deposit rules are:
    - separate account = Yes -> show method, account type, signer.
    - separate account = Yes AND method = enter numbers -> show account
      number and routing number.
    - separate account = Yes AND method = upload -> show the upload.
    - separate account = Yes AND method = upload -> require the upload.
    - method = upload -> unrequire account number and routing number.
    Account number and routing number are required at field level, so no
    require rule is needed for them; hidden required fields do not block.
    How it got there: the builder's first attempt rewrote the old require
    rule into the two-term show rule instead of editing the show rule.
    Naming the rule by its condition ID (from the tester's dump) is what
    made the later deletes and the edit land on the right rule.
  - About 4:50 PM Matt deleted "Unit numbers or letters at this address"
    in the editor ("i dont think we need it"). Confirmed gone from the
    question list. Unit numbers now come in only through the optional
    "Unit list" (or the unit spreadsheet upload) and the Tenant list, so
    Alaina may have to ask for them when setting up utilities on a
    multi-unit property. Its "unit count above 1" show rule may be left
    behind as an orphan (tester asked to check).
  - REVERTED: that 4:50 PM editor save came from a tab loaded before the
    deposit toggle-back fix and wrote its old copy of the rules back
    (tester pulls 5:03 and 5:26 PM: 112 fields, 62 conditions). The
    toggle-back bug is live again: Yes -> enter numbers (empty) -> No
    blocks submit. Live deposit rules are back to: one-term show rules for
    the number fields (262804097026053) and the upload (262804068408055),
    "method = upload -> show upload, hide numbers" (262804427702051), and
    262804456930056 is a require rule again. After the revert the builder
    worked from a different copy: it said 262804097026053 no longer exists
    and that 262804427702051 already matched the fix, and it would not
    list the rules.
    Lesson: an open editor tab overwrites builder edits on its next save.
  - REDONE 5:35 to 5:48 PM through the builder, tester-verified (pull
    5:56 PM, cases A-N run 5:57 to 6:05 PM, all correct, no wrong submit
    block; 113 fields, 61 conditions). What got the builder unstuck:
    asking it to re-read the conditional logic fresh from the published
    form and to delete a rule outright by condition ID, then adding the
    corrected rule as a new rule in the next edit. Deleted 262804427702051,
    262804068408055 and 262804097026053. Deposit rules now:
    - 262806901963059 show: 110 = Yes AND 29 = Enter -> Show 32, 33
    - 262807253844058 show: 110 = Yes AND 29 = Upload -> Show 31
    - 262805543116050 require: 110 = Yes AND 29 = Upload -> Require 31
    - 262804456930056 require: 29 = Enter -> Unrequire 31, Require 32, 33
      (left in place; harmless because hidden required fields do not block)
    - 262804427922055 require: 29 = Upload -> Unrequire 32, 33
    - 262804399023055 show: 110 = Yes -> Show 29, 30, 34
  - Contact preference ranked (Matt, ~5:48 PM): field 124 retitled "What is
    your first choice for how we contact you?"; new required field 125
    "What is your second choice for how we contact you?" (Email / Phone
    call / Text message) directly after it. Tester confirmed both render
    and 125 blocks submit when empty. Nothing stops the same option being
    picked for both. Matt declined renaming the occupancy options
    (Yes / No / Some stay) because every rule keyed on them would break.
    Four stale rules still point at the deleted unit numbers field
    (262805402980053, 262804848434060, 262805380628057, 262805380431049);
    harmless, a 4-unit form passes validation.
  - Open after the final pass:
    - Not checked: when an owner types deposit numbers and then switches
      to upload or to No, the typed numbers are still in the hidden inputs.
      Whether they reach the submission depends on the form's "clear
      hidden field values" setting.
    - "Tenant list" loads with no rows (an "Add Row" button) while being
      required.
    - Before a tenant-details method is picked, the rent roll upload and
      the Tenant list both show, so an owner who skips the method question
      gets three required errors at once.
    - Unit count and subsidized count accept decimals; subsidized count is
      not capped at the unit count. Deposit account number accepts a
      hyphen. Rent fields accept letters. "None of these" can be ticked
      with other services. Deposit account type and signer are optional.
    - Warranty questions sit after the HOA pair at the end of the vendor
      section. The "Existing Tenant Information" heading shows for every
      owner.
    - Six test submissions in the inbox to delete: "CLAUDE TEST Ignore Me"
      and A, B, C, D, plus Matt's own two.
  - Jotform rule behaviour learned here: a "hide" rule SHOWS its targets
    whenever it is false, so a hide rule and a show rule on the same field
    fight. Prefer show-only rules with every needed term.
- Still not on the form from Alaina's emails: owner signatures on the
  Consumers consent, DTE ATS and GR water agreement forms. Proposed to Matt
  as a DocuSign packet with the contract rather than a Jotform field; not
  decided.
- Shelved: DocuSign completion triggering the form and prefilling it from
  the signed management contract. GPM has no DocuSign template yet; revisit
  when it does.
- Still Claude's guesses, awaiting Laura: the grid's "Not applicable"
  column, tax escrow "Not sure", "Some units occupied", market-rent "No" wording, dropdown
  choices (heating, water heater, laundry, account type, prior management,
  referral source), date of birth for entity signers.
- Decided but not built: repeat owners get their own separate form.

## Rebuild on 2026-10-08

- Form ID: 262803708612052
- URL: https://form.jotform.com/262803708612052
- Rebuilt from the question list below in the Jotform account the connector
  now reaches (the original 262517205694056 is not in that account).
- Question titles match the original. Answer options and show/hide logic are
  NOT the original's: they were rebuilt from Laura's 2026-09-10 reply on the
  "New Client Onboarding" email thread where she specified them, and are
  best guesses everywhere else.

## GPM New Client Onboarding — Owner Intake (current version)

- Form ID: 262517205694056
- URL: https://form.jotform.com/262517205694056
- Created 2026-09-09, last edited 2026-09-18, 0 submissions
- Status on 2026-10-08: DISABLED by Jotform (account flagged for collecting PII, needs verification)

### You & Your Entity
- Full legal name
- Are you signing as an individual or a business entity?
- Entity legal name
- Social Security Number (or EIN / Tax ID if signing as an LLC)
- Date of birth
- Phone number
- Email address
- Mailing address

### The Property
- Property address
- Number of units at this address
- Are there tenants currently living there?
- How was this property managed before you signed with us?

### Utilities Today
_Best-guess answers are fine — we verify everything directly with each utility once you submit._
- Who currently receives the bill for DTE (electric/gas)?
- Who currently receives the bill for Consumers Energy?
- Who currently receives the bill for water?
- Once we take over, where should these utility accounts live?

### Banking
_Two separate accounts, asked separately — general expenses and security deposits can't be commingled._
- General / Operating Account — Account type
- General / Operating Account — Upload a voided check
- Would you like to authorize designated GPM representative(s) to be added as authorized signer(s) on this account?
- Security Deposit Account — Account type
- How would you like to provide your Security Deposit account details?
- Upload a voided check or bank letter
- Deposit account number
- Deposit account routing number
- Would you like to authorize designated GPM representative(s) to be added as authorized signer(s) on this account?

### Existing Tenant Information
_Tell us about who's currently living at the property, if anyone._
- Is this property currently occupied?
- How would you like to provide tenant details?
- Upload current lease(s)
- Upload move-in inspection/inventory checklist, if available
- Upload rent roll / tenant ledger
- Tenant name(s)
- Unit/address, if applicable
- Tenant phone number
- Tenant email
- Lease start date
- Lease end date
- Current monthly rent
- Security deposit amount
- Where is the security deposit currently being held?
- Outstanding tenant balance, if any
- Any current payment plans?
- Any pending notices, evictions, or legal issues?
- Any concessions or special agreements with the tenant?

### Physical Property & Access Information
_This isn't a full inspection — just the property-specific details and access info your property manager needs from day one._
- Heating type
- Cooling
- Water heater type
- Laundry setup
- Parking arrangement
- Garage/storage information
- Keys, access codes, garage remotes, mailbox keys, etc.
- Lockbox or access instructions
- Any known deferred maintenance?
- Any major projects currently underway?
- Any known code violations or outstanding municipal issues?

### Existing Vendors & Property Services
_Knowing who's already servicing the property saves a lot of back-and-forth during the transition._
- Current lawn care provider
- Snow removal provider
- Trash provider
- Pest control provider
- HVAC/boiler service provider
- Elevator, fire, security, or other property-specific vendors
- Any other recurring vendors or contractors
- Upload existing vendor/service contracts, if applicable
- Are there any contracts we need to cancel, continue, or take over?
- Any existing warranties or service plans?
- HOA/condo association information, if applicable
- Appliances supplied by owner

### Mortgage, Taxes & Insurance
- Does the property have a mortgage?
- Mortgage lender name
- Lender contact information (phone or email)
- Would you like GPM to pay the mortgage, or will you continue paying it yourself?
- Insurance company
- Insurance agent / contact information
- Upload current insurance declarations page
- Are your property taxes escrowed (paid automatically through your mortgage)?
- Would you like GPM to pay your property taxes, or would you prefer to pay them directly?

### Leasing Information
_A few questions about how this property should be leased going forward._
- Current advertised rent, if vacant
- Owner's desired rent, if different from advertised
- Is GPM authorized to determine market rent?
- Pets allowed / any owner restrictions beyond our standard policy
- Utilities included in rent, if any
- Any upcoming vacancies or non-renewals already known?

### Documents & Referral
- Upload a photo ID
- How did you hear about us?
_Submitting sends your management agreement for signature and starts the onboarding checklist — nothing is filed with a utility or the city until you've signed._
- Submit intake

Section order above follows the question groupings; the connector returned the
questions in creation order, so the on-form order of sections is not confirmed.

## Clone of GPM New Client Onboarding — Owner Intake (early snapshot)

- Form ID: 262525723112045
- URL: https://form.jotform.com/262525723112045
- Created and last edited 2026-09-10, 0 submissions
- Status on 2026-10-08: ENABLED

An older, shorter version (39 questions). Differences from the current form:

- Has, and the current form dropped: Driver's license number; Driver's license issuing state
- Has, and the current form dropped: Repair & Maintenance Authorization section
  - _Green Property Management handles routine repairs and preventive maintenance on your behalf. Choose the spending limit we can approve without contacting you first — anything above it, we'll always call before moving forward._
  - What's your approval limit for repairs and appliance replacements?
- Authorized-signer questions are worded "Can GPM be added as an authorized signer on this account?"
- Security Deposit Account asks only for account type + voided check upload (no typed account/routing number)
- Lacks everything added later: Existing Tenant Information, Physical Property & Access, Existing Vendors, Mortgage/Taxes/Insurance, Leasing Information
