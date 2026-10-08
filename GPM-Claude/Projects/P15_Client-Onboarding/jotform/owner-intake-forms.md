# P15 Jotform backup — Owner Intake forms

Pulled from Jotform on 2026-10-08. Question titles only: field types, answer
options and conditional logic are not included (the connector doesn't return
them), so this is enough to rebuild the forms by hand, not to restore them.

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
