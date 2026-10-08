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
  - Tenants table: rent, deposit and balance columns are plain text (the
    number spinners would not accept input); an added rule hides the table
    when the owner chooses to upload a rent roll.
- Gaps found against Alaina's 624 Veto utility set-up emails (not on the
  form, proposed to Matt): owner signatures on the Consumers consent, DTE
  ATS and GR water agreement forms; subsidized units Y/N + count and tax
  exempt Y/N (Consumers landlord portal sheet); a date (tenant move-in /
  ownership or requested effective date); unit numbers for multi-unit DTE
  enrollment (only in the optional Unit Details section).
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
