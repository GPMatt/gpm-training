# Vendor AP Demo — button-triggered, live sandbox

Built for a ~15 min in-person demo to Laura and Alaina (GPM bookkeeping/AP).
Read `../README.md` first — it's ground truth for what Rentvine's API can and
can't do (quirks #1/#2/#3/#6/#7 are the ones this code exists to work around).

## What this is

One button. Click it, and 3 realistic mock vendor invoices get turned into
correctly-coded Bills in the **live** Rentvine sandbox — no slides, no fake
typing, no mockups. Centerpiece is the "batching" framing: multiple invoices
in, multiple correctly-coded bills out, grouped by owner/portfolio the way a
payment batch would look.

- `Royal Pest Control` — recurring vendor, static vendor→property mapping
  (`vendor_map.json`), low judgment call.
- `Sherwin Williams` — job-driven vendor, property comes from the job site
  address printed on that invoice, changes every time. This is the vendor
  shape behind today's real wrong-owner mistakes.
- `Coastal Air Mechanical` — a second recurring/contracted vendor (HVAC), for
  variety and a third portfolio in the batch view.

## Running it

```bash
cd GPM-Claude/Projects/P20_Rentvine-Demos/vendor-ap-demo
python3 server.py
```

Open `http://localhost:8420`, click **Run this batch**. Requires `requests`
(`pip install requests` if not already present — it was already on this
machine).

The Rentvine sandbox credentials live server-side in `pipeline.py` only —
`index.html`/the browser never sees them.

**After clicking:** switch to the real Rentvine sandbox UI (Money Out →
Bills / Payables) and show the same bills sitting there, correctly coded.
That's the part that will actually land for Laura and Alaina — the
button/terminal output means nothing to them on its own.

## What it does NOT do (say this out loud in the demo)

- **Does not pay anything.** Rentvine's payout/disbursement step is UI-only
  (no API for it, by Rentvine's own design) — this pipeline's job ends at
  "bills created, correctly coded, sitting in payables." Running the actual
  payment batch is still a manual step, and that's also where the real
  segregation-of-duties control lives — see quirk #7 in the parent README
  (`Is Payout Approved By Default`) — worth mentioning since it's directly
  relevant to Laura/Alaina's own job.
- **Does not OCR or parse real invoice images/PDFs.** The 3 invoices are
  hardcoded structured data in `invoices.json` — intentionally, to keep a
  15-minute live demo reliable. Say this plainly if asked.

## Idempotency (why clicking twice is safe)

Rentvine has no server-side dedup — POSTing the same bill payload twice
creates two separate fully-approved bills. `ledger.json` (gitignored, created
at runtime) tracks which `invoiceRef` values have already produced a bill.
Clicking the button again re-confirms and re-displays those bills instead of
re-posting them. Verified live 2026-09-11: first run created bills 19/20/21;
second run returned `skipped-duplicate` for all three with no new bill
created (confirmed no bill 22 exists).

To reset for a clean re-run (new bills instead of reusing the ones above),
delete `ledger.json` — but note the mock vendors/bills from this and the
original 2026-09-11 validation pass (Royal Pest Control TEST contactID 176,
Sherwin Williams TEST contactID 177, bills 16/17/18, and this build's
non-TEST vendors 178/179/180 + bills 19/20/21) will still exist in the
sandbox. That's fine — they don't collide with a fresh run since dedup keys
off `invoiceRef`/reference, not vendor name reuse.

## Files

- `invoices.json` — the 3 mock invoices.
- `vendor_map.json` — static vendor→property/account mapping for recurring
  vendors only (job-driven vendors resolve per-invoice, see `pipeline.py`).
- `pipeline.py` — all Rentvine API calls: resolve vendor (check-then-create),
  resolve property → ledgerID (exact-match filter — Rentvine's
  `ledgers/search` is substring, not exact: `search=Hello1` also returns
  Hello10/11/12), POST the Bill, re-fetch to confirm it landed (never trust
  a 200 alone), maintain `ledger.json`.
- `server.py` — stdlib `http.server`, no framework. Serves `index.html` and
  two endpoints: `GET /api/invoices` (preview), `POST /api/run` (the button).
- `index.html` — the button page. Plain HTML/CSS/JS, no build step.

## Verified live 2026-09-11

Full run confirmed against the sandbox: 3 bills created (19, 20, 21), each
re-fetched and cross-checked against `/accounting/payables` for correct
ledger/account/amount before being marked "confirmed" — Royal Pest Control →
Hello6/portfolio 3/$145, Sherwin Williams → Hello1/portfolio 1/$312.47,
Coastal Air Mechanical → Hello3/portfolio 2/$210. Second click correctly
skipped all three as duplicates.

## Questions to actually ask Laura and Alaina live

- Does the WO#→property resolution match how they'd expect it to work, or
  are there real invoice formats (multi-property invoices, partial payments,
  credits) that would break this?
- For the job-driven case (Sherwin Williams-style) — does seeing the bill
  *before* it's batched give them enough to catch a coding mistake, or would
  they want to see something different at that point?
- Is the vendor→property mapping for recurring vendors (pest control, HVAC)
  actually as static in practice as `vendor_map.json` assumes, or does it
  change more often than that?
