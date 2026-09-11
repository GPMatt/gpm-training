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

## Where things should live as they get built

Keep each demo's actual code in its own subfolder here
(`billback-demo/`, `route-demo/`, `delinquency-demo/`) rather than mixing it
into this README, and update the status lines above as they move from
"case built" → "prototype" → "demo-ready."
