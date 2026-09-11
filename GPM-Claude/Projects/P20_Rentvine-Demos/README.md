# P20 — Rentvine Demos

**Purpose:** Rentvine is a candidate PM platform that GPM could pitch as an
AppFolio replacement (or run automations against, if GPM ever migrates). This
project evaluates Rentvine's write/read API in a sandbox and builds a small
set of demos to show GPM leadership what becomes possible on top of it.

This folder is self-contained — everything a fresh Claude session needs to
pick this up and keep going lives in this file. Don't assume prior
conversation context.

## Credentials & environment

**This is a sandbox/demo account** — "Demo Account 33: Green Property
Management Group", **expires 2026-10-01**. Safe to write-test freely; nothing
here touches GPM's real AppFolio data or production systems.

```
Base URL : https://demopm33.rentvine.com/api/manager
Auth     : HTTP Basic — username = access key, password = secret
Access Key : e8b39bfd118949448dbfb0e8a63f6924
Secret      : 50548bff12d54703b7b41fdc34373ef8
Headers  : Accept: application/json  (and Content-Type: application/json for POST)
```

Quick test:
```bash
curl -u "e8b39bfd118949448dbfb0e8a63f6924:50548bff12d54703b7b41fdc34373ef8" \
  -H "Accept: application/json" \
  "https://demopm33.rentvine.com/api/manager/properties"
```

**Docs:** docs.rentvine.com and help.rentvine.com exist, but docs.rentvine.com
has gotten several paths **wrong** (e.g. said `/contacts/owners`, real path is
`/owners`; said `/maintenance/technicians`, real path is
`/maintenance-technicians`). It was, however, accurate for the `/export` and
`/search` endpoints below. **Always verify every path empirically against the
live sandbox before trusting docs text.** help.rentvine.com is end-user help
content only, not developer docs — not useful here.

If this sandbox has expired by the time you read this, ask the user for a
fresh demo account before continuing.

**Before investigating whether Rentvine supports some new capability**, check
both doc sites first — don't jump straight to guessing endpoint paths against
the sandbox:
- https://help.rentvine.com/en/ — end-user product docs, tells you whether a
  *feature* exists at all (e.g. is there a leasing CRM, guest cards, showing
  scheduling) even though it's not developer API docs.
- https://docs.rentvine.com/ — API reference, tells you what's *exposed*.
  Known to get some paths wrong (see below) — verify empirically after.

## Confirmed-working endpoints (verified live, 2026-09-11)

| Endpoint | Method | Notes |
|---|---|---|
| `/properties`, `/properties/{id}` | GET | includes pre-validated `latitude`/`longitude` (Google-geocoded) |
| `/owners` | GET | NOT `/contacts/owners` |
| `/portfolios` | GET | |
| `/vendors`, `/vendors/{id}` | GET | vendor contact detail — NOT `/accounting/vendors/{id}` |
| `POST /vendors` | POST | `{"name": "..."}` creates a Vendor contact |
| `/accounting/accounts` | GET | chart of accounts, resolves chargeAccountID → name |
| `/accounting/bank-accounts` | GET | has `bankAccountNextCheckNumber`, `unprintedCheckCount` |
| `/accounting/bills`, `/accounting/bills/{id}` | GET/POST | create a Bill — see BillBack demo below |
| `/accounting/payables` | GET | unpaid bill transactions queue (read-only) |
| `/accounting/transactions` | GET | raw ledger transaction feed |
| `/accounting/transactions/search` | GET | richer — inlines ledger name |
| `/accounting/ledgers/{id}` | GET | |
| `/accounting/ledgers/search` | GET | richer — inlines unit/lease |
| `/leases`, `/leases/{id}` | GET | |
| `/leases/export` | GET | **per-tenant delinquency data, pre-aggregated** — see Delinquency demo below |
| `/tenants`, `/tenants/{id}` | GET | |
| `/maintenance/work-orders` | GET | scheduling + priority fields — see Routing demo below |
| `/maintenance-technicians` | GET | NOT `/maintenance/technicians` |
| `/reports?reportTypeID={N}` | GET | returns a named report's column/filter **schema only**, not data rows (60+ report types enumerated; no working "execute" endpoint found — don't burn time re-guessing this, use `/export` and `/search` instead) |
| `/screening/applications` | GET | confirmed 200, empty array in this sandbox (no test data) — the closest thing to a "new prospect" hook Rentvine's API exposes |
| `/screening/applications/export` | GET | confirmed 200 (empty in sandbox). Per docs.rentvine.com: filterable by `dateTimeModifiedMin/Max`, `primaryApplicationStatusIDs[]`/`applicationStatusIDs[]` (enum 1-8), `hasLease`, paginated — **pollable the same way `/leases/export` is**. Each record: `applicationID`, `unitID`, address, status IDs, timestamps, `applicants[]` (`applicantID`, `name`, `email`, `phone`) |
| `/screening/applicants` | GET | confirmed 200, empty in sandbox |
| `POST /screening/applications/{id}/status` | POST | per docs.rentvine.com — writes an application's status. **Untested empirically** (no application record exists in sandbox to test against) — verify before relying on it, per the docs-can-be-wrong quirk |

## Confirmed NOT available — leasing/prospect funnel (checked 2026-09-11)

Checked both doc sites (help.rentvine.com + docs.rentvine.com) and probed ~20
plausible paths against the sandbox: **Rentvine has no API for the top-of-
funnel leasing/prospect side** — no leads, guest cards, showing/tour
scheduling, or appointment endpoints exist anywhere, confirmed or documented.
- help.rentvine.com has no leasing-CRM/guest-card/showing/tour help category
  at all — the product itself doesn't appear to have this as a Rentvine-native
  feature ("Screening" and "Residents" categories exist but cover tenant
  screening and post-lease resident portal, not pre-lease prospects).
- docs.rentvine.com's "Marketing" section only lists "Search Listings" and
  "Get Property Image" — the search-listings path itself 404'd on every guess
  tried (`/marketing/listings/search`, `/listings/search`, etc.), consistent
  with docs.rentvine.com's known unreliable-paths quirk.
- The only real, verified hook into the leasing funnel is `/screening/applications`
  (see confirmed-working table above) — i.e. Rentvine only sees a prospect
  once they've submitted a rental **application**, not at initial inquiry.

**Refined finding (still 2026-09-11):** `/screening/applications/export` is
genuinely pollable — it takes `dateTimeModifiedMin/Max` filters just like
`/leases/export` does, so "check every 5 min for new/changed applications" is
a real, buildable pattern, and `POST /screening/applications/{id}/status`
(untested — verify first) means status changes could be automated too, not
just read.

**The catch that determines everything:** Rentvine only sees a prospect once
they submit a full rental **application** — there is still no raw
lead/inquiry/guest-card object anywhere (confirmed via help.rentvine.com, all
80 `/reports` type names — the closest are "Listings" #19 and "Vacancy" #30,
schema-only, no working data export — and ~25 endpoint-path probes). Whether
`/screening/applications/export` can drive a "prescreen → book a showing
within 48h" flow depends entirely on **GPM's actual funnel order**: if
prospects apply *before* touring (some PM shops require this), this endpoint
fires at exactly the right moment. If prospects tour *before* applying (more
common), this fires too late — the showing already happened. **Ask the user
which order GPM's process follows before designing further.**

There's also a community MCP server (`Rentor-CA/Rentvine-MCP` on Glama) —
Rentvine itself stopped maintaining it ~2026-04-25, so it's a third-party fork
wrapping the same API, not a source of additional data. Not worth building on
for a production workflow; mentioned here only because it exists.

No showings/tours/appointment API exists at any level — that half of the
workflow always needs an external tool (Calendly-style) or a human, no matter
which funnel order GPM uses.

## Known quirks — read before building anything

1. **No write dedup.** POSTing the identical Bill payload twice (same
   `reference`) creates two separate fully-approved Bills. Any automation
   MUST implement its own idempotency (check-before-create, or an external
   ledger of already-processed IDs).
2. **Payout/disbursement is UI-only.** No endpoint exists to trigger or
   confirm an actual payment run — `/accounting/payables` is read-only, and
   nothing under `/accounting/payouts`, `/accounting/bulk-payments`,
   `/accounting/bills/{id}/pay` etc. exists. A human has to run the check
   batch in the Rentvine UI. Automation can create the Bill and poll
   `amountPaid` to detect when it's been paid, but can't force it.
3. **Silent no-op on some writes — don't trust HTTP 200 alone.** Both a
   vendor email update and a Bill `isVoided:1` update returned `200 OK` but
   the field never actually changed on re-fetch. **Always re-fetch after any
   write to confirm it landed before treating it as done.**
4. **No void/delete for Bills via API** — `/accounting/bills/{id}/void` is
   404, `DELETE` returns `400 invalid input`, and the isVoided-update quirk
   above means corrections need a human in the Rentvine UI.
5. Error responses are clean, structured 400s keyed by field path (e.g.
   `{"charges[0].ledgerID":["Payer is Invalid"]}`) — safe to branch on.
6. **A created Bill is auto-approved — there is no API-native "pending
   approval" state at the Bill level.** `POST /accounting/bills` always
   comes back `isApproved: 1`, `approvedByUserID` set to the API key's own
   user, even when the payload explicitly sends `"isApproved": 0` (tested
   2026-09-11 — the override is silently ignored, re-fetch confirms it
   stays `1`). It lands in `/accounting/payables` immediately, one step
   from being paid in the next disbursement run. This by itself is not the
   whole story — see the maker-checker note below.
7. **Real maker-checker control exists, but at the payment-batch step, not
   Bill creation — and it's a Settings toggle, not an API-controllable
   field.** Confirmed via help.rentvine.com (not the sandbox — this is
   account configuration, not something we found an endpoint for): the
   Accounting Setting **"Is Payout Approved By Default"** governs whether
   submitting a payment batch (the "Approve on Submission" + MFA screen we
   walked through manually) auto-releases the money or leaves the batch
   **pending approval** for a second person holding the separate "Approve
   Bill Pay Batch" permission. **Implication for automation design:** don't
   try to gate a Rentvine-based vendor-AP pipeline by holding the Bill back
   before POSTing it (quirk #6 already rules that out as unreliable/not
   supported) — instead, let automation freely create correctly-coded Bills
   all month (auto-approved into payables is harmless, nothing pays yet),
   and get "Is Payout Approved By Default" turned OFF so whoever stages a
   payment batch and whoever approves its release are two different
   people. That's a real segregation-of-duties control on the step that
   actually matters (money leaving), and it's the right place to put review
   weight for the higher-risk job-driven vendor case (Sherwin Williams/ACE)
   from demo idea #4 below. Not yet verified whether this setting is
   toggleable via the API or only in the UI — check before assuming
   either way.

Full raw findings (extra detail, IDs used in testing) if needed: this
evaluation was originally run and logged in Claude's memory as
`reference_rentvine_api_eval.md` and `reference_rentvine_delinquency_api.md`
— ask the user if you need the original session's blow-by-blow.

## Demo projects to build (for a GPM leadership pitch)

### 1. BillBack 2.0 — CC receipt reimbursement via Rentvine
**Status: evaluated, not yet built.**
Replaces the QuickBooks leg of the existing [P12 BillBack pipeline]
(`../gpm-cc-billing/`) — after a CC receipt is parsed/enriched, POST a Bill
directly to Rentvine coded to the owner's property, payee = GPM, letting
Rentvine's own payout run reimburse GPM and reduce the owner's distribution.
Bill creation works well (see confirmed endpoints above). The catch: payout
execution is UI-only (quirk #2) and there's no write dedup (quirk #1), so the
demo needs to show the Bill landing correctly in Rentvine's payables queue
and be honest that a human still runs the actual payment batch — frame it as
"eliminates the QuickBooks round-trip and manual bill entry," not "fully
hands-off."

### 2. Tech route building via Rentvine data
**Status: case built, not yet built.**
The current route builder ([P07 Beta-Routing](../P07_GPM_Beta-Routing/),
[P16 Route App](../P16_Route-App/)) geocodes property addresses itself and
consumes a daily CSV import of work orders. Rentvine could replace both of
those steps:
- `GET /properties` already returns **Google-validated `latitude`/`longitude`**
  per property — no geocoding API call needed at all.
- `GET /maintenance/work-orders` returns `scheduledStartDate`,
  `scheduledEndDate`, `appointmentWindowStartDateTime/EndDateTime`,
  `priorityID`, `assignedToUserID`, `vendorTradeID`, `propertyID`/`unitID` —
  everything the k-means/NN-TSP/2-opt pipeline needs, live, instead of a
  once-a-day CSV.
- Not yet verified: whether work orders can be **written back** to
  (e.g. updating `scheduledStartDate`/`appointmentWindowStartDateTime` so the
  optimized route shows up on the tech's/owner's Rentvine calendar) — test
  this before promising it in the demo. If it works, the pitch is "the route
  optimizer both reads and writes the schedule," which is a much stronger
  demo than a one-way CSV feed.

### 3. Fully automated delinquency filing
**Status: concept, not yet built.**
`GET /leases/export` returns per-lease `balances`
(`unpaidTotalAmount`/`unpaidRentAmount`/`pastDueTotalAmount`/`pastDueRentAmount`)
and itemized `unpaidCharges[]` (with `isOverdue`) — pre-aggregated, no manual
ledger math needed. This is the same kind of data
[P10/P11 Delinquency Automation](../P11_Delinquency_Automation/) currently
pulls from AppFolio to fill DC 100a forms. A Rentvine-native version could
skip the CSV/report-export step entirely: poll `/leases/export` on a
schedule, flag any lease crossing a past-due threshold, and auto-generate/file
the notice — closer to "fully automated" than the current AppFolio pipeline,
which still needs a human to pull the report. Payout/write-back isn't a
concern here since this workflow is read + document-generation, not a
Rentvine write.

### 4. Vendor AP automation — Sherwin Williams-style owner-direct bill pay
**Status: prototype built 2026-09-11 — button-triggered demo at
[`vendor-ap-demo/`](vendor-ap-demo/), verified live against the sandbox
(3 bills created, correctly coded, idempotency guard confirmed against a
double-click). Not yet run live in front of Laura/Alaina — move to
"demo-ready" after that.**
Distinct from BillBack 2.0 above: BillBack recoups a *GPM credit-card* receipt.
This is for vendors that invoice GPM with terms and get paid **directly out
of an owner's funds** — Alaina currently keys these into AppFolio by hand,
20+ hrs/week, with real wrong-owner coding mistakes happening. Matt confirmed
most GPM vendors already work this way (Sherwin Williams, Royal Pest Control,
HVAC contractors, occasionally ACE), each invoice already carries a job/WO
reference, and the actual payment mechanic is: a Bill gets keyed into
AppFolio coded to the right owner/property, and AppFolio's normal
disbursement run pays it via ACH from the owner's trust funds — the same
Bill → payables-queue → human-run-disbursement shape Rentvine already
supports.

**Two vendor shapes, two different risk profiles — don't build them as one
automation:**
- **Recurring/contracted vendors** (pest control, HVAC service contracts,
  lawn) — same vendor bills the same property every cycle. The
  vendor→property/owner mapping is static, so this is low-risk: no
  per-invoice judgment call, nothing to get wrong once the mapping is set up
  once. This also overlaps with [[project_p15_client_onboarding]]'s
  `recurring_bills` checklist item — one mapping table could serve both.
- **Job-driven vendors** (Sherwin Williams for a specific paint job, ACE
  parts) — owner/property depends on which WO the invoice references, which
  changes every time. This is where the current "wrong owner billed"
  mistakes come from, and it's the harder case to automate safely.

**Validated live in the sandbox (2026-09-11):** created two test vendors
(`Royal Pest Control (TEST)` contactID 176, `Sherwin Williams (TEST)`
contactID 177) and two mock Bills — one recurring-shape (property `Hello6`,
ledgerID 11, portfolio 3, Landscaping account as a Pest Control stand-in —
**note: sandbox chart of accounts has no dedicated Pest Control expense
line**, one would need to be added) and one job-driven-shape (property
`Hello1`, ledgerID 6, portfolio 1 — a *different* owner, Painting account,
reference tagged with a mock WO#). Both landed correctly in
`/accounting/payables` coded to their respective property/portfolio,
unpaid, confirming the core mechanic: parse invoice → resolve vendor+WO to
the right ledger → POST a correctly-coded Bill. Test bills: billID 16, 17
(quirk #6 test: billID 18, explicit `isApproved:0` ignored).

**Approval design (see quirks #6/#7 above):** a Bill is always auto-approved
on write, so don't try to hold it back before POSTing — that's not a
supported state. The real gate belongs on the *payment batch* step:
turn off "Is Payout Approved By Default" in Accounting Settings so batch
staging and batch approval are two different people. Recurring/contracted
vendors (static mapping, low error surface) can probably ride through on a
lighter review; job-driven vendors (Sherwin Williams/ACE, where owner
depends on a per-invoice WO match) should get a real second-person look at
the batch before it's approved, since that's the source of today's actual
coding mistakes.

**Manual disbursement is genuinely heavy today, confirmed by walking it
live 2026-09-11:** paying a single already-approved Bill (Bill 17,
Sherwin Williams, $340) took ~10 screens — Bills list → select → Actions →
Pay Bills → re-search with bank account/date/payee → check payable → Post
→ confirm dialog → toggle approve → MFA code → Submit Payments → batch
page — and confirmed paid via `amountPaid` on re-fetch. This isn't
shortcut-able by any automation (quirk #2, payout is UI-only everywhere,
AppFolio included). The actual win isn't skipping this flow, it's
batching: an automation that keeps bills correctly coded and queued all
month turns N×(manual coding + this 10-screen walkthrough) into
N×(auto-coding) + one batch run through this flow.

## Where things should live as they get built

Keep each demo's actual code in its own subfolder here
(`billback-demo/`, `route-demo/`, `delinquency-demo/`) rather than mixing it
into this README, and update the status lines above as they move from
"case built" → "prototype" → "demo-ready."
