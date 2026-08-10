# P12 BillBack — End-to-End Test Runbook

Everything through Phase E is built and none of it has run end to end. This is the
one testing layer, run against **live data mid-cycle**, so the governing constraint
is that the ~200 receipts still waiting to bill must be re-billable afterward as if
nothing happened.

**Why they must survive untouched**, concretely:

- **Status is the ledger.** A row left on `Sent` is invisible to the next snapshot —
  a receipt that silently never bills to an owner, with no error anywhere.
- **A charge can only be spent once.** Consuming a charge here strands the real
  receipt that needed it.
- **File location is not cosmetic.** `Current Statement/<address>/` is what defines
  "this period's receipts", and the file IDs are what get attached to the invoice.

Two things are **not** reversible, accepted up front: two QB DocNumbers are consumed
permanently, and attachments uploaded to the test invoices may survive as orphaned
Attachables after the invoices are deleted.

---

## What test mode actually changes

| Surface | Normal | Test mode |
|---|---|---|
| `_archiveCurrentStatementFolder` | renames the live folder, creates a fresh one | **no-op**, logs the rename it would have done |
| `_archiveSettledReceipts` | moves every settled receipt in the sheet | **dry run**, prints every source → target, moves nothing, creates no folders |
| Billing snapshot | every `Ready` row | narrowed to `TEST_ROWS` |
| GL assignment queue | every enriched, uncoded row (~200) | narrowed to `TEST_ROWS` |
| All four senders | owners, Alaina, Laura, cardholders | `TEST_EMAIL_OVERRIDE` (already built) |

**Not** neutered, on purpose: the statement gate, the matcher, the approval gate,
invoice creation, attachment, sending, and Merchant Map / GL Memory learning. Stubbing
those would test a different program than the one that bills.

### The guard pair

- `TEST_MODE` armed + `TEST_EMAIL_OVERRIDE` blank → **refuses to run.**
- `TEST_MODE` off + `TEST_EMAIL_OVERRIDE` set → **refuses unless you confirm**, and
  refuses outright with no UI. This is the dangerous direction: a real 200-receipt
  run where every owner invoice, chase email and the receipt packet quietly route to
  one inbox and the summary reports complete success. Health Check also stops on it.

---

## Pre-flight

1. Menu → **Repair GL Chart Numbers** (the `NNNN-N` → date coercion fix).
2. Menu → **Health Check**. Expect the 5 chart tabs, GL Memory tab, and no red lines.
3. Confirm the **Statements tab is empty** and the **Reconciliation tab is empty**.
4. Config tab, add **one** row for now:
   | Key | Value |
   |---|---|
   | `TEST_ROWS` | *(blank — step 1 fills it)* |

   `TEST_MODE` and `TEST_EMAIL_OVERRIDE` are added together at **step 4 of the run**, not
   here. Setting the override while `TEST_MODE` is off is precisely the state the guard
   pair treats as a STOP — in normal operation it means a real cycle whose invoices all
   silently reroute — so creating it during setup just fires a false alarm at yourself.
5. Delete the dead `STATEMENT_START_DATE` Config row if still present.

   > **Do NOT delete `STATEMENT_END_DATE`.** An earlier version of this runbook
   > said to remove both, and `billingCycle.js` still carries a comment calling
   > both "gone". That is true of `STATEMENT_START_DATE` only.
   > `STATEMENT_END_DATE` is written by `statementParse.js` on every kept parse
   > and READ by `onFormSubmit.js` and `errorRetry.js` — it is what marks a new
   > submission `Prior Period` when its purchase date falls inside a statement
   > that has already closed. Delete it and that guard silently stops firing,
   > and stragglers start landing as ordinary `Pending` again.

> **Don't run between 4am and 6am** — the daily enrich (4am) and GL (5am) triggers fire
> then, and with test mode armed the GL trigger would process only your test rows and
> skip its real work.

---

## The run

### 1. Pick the rows
Menu → **Test — Propose Test Rows**. It reports two owners × three receipts chosen for
coverage (different GL charts, different AppFolio accounts, one multi-property owner),
and for each row: amount, date, merchant, GL chart, and **the exact cardholder heading
string** the statement must print for it.

Act on three things it tells you:
- Any merchant marked `*** BLANK ***` — type the real merchant into **col T** first.
- The earliest legal **Closing Date**. Receipts dated past `stmt.end` are dropped from
  the pool entirely (`reconcile.js:524`).
- Whether a **natural double-match collision** exists. If not, set one row's col K equal
  to another's (same cardholder) to reach that branch — col K is snapshotted, so revert
  puts it back.

Paste its `TEST_ROWS` line onto the Config tab.

### 2. Snapshot
Menu → **Test — Snapshot Before Run**. Captures the test rows' restorable columns, the
**full Status and GL columns for every row** (the containment tripwire), the four
learned/derived tabs, and the Current Statement folder ID.

Do not skip this. Verify and revert both read from it.

### 3. Build the statement
Fill in `spec_template.json` from the proposal, then:

```
cd GPM-Claude/Projects/P12_CC_Billing/test
python3 -m venv venv && ./venv/bin/pip install reportlab
./venv/bin/python make_test_statement.py spec.json GPM-TEST-Statement.pdf
```

Drop the PDF in the statement folder (`150vo8neNGxR3RTdOgIrhuUriawiYA6U3`).

### 4. Arm
Config tab, add both keys **in this order** so the STOP state never exists:

| Key | Value |
|---|---|
| `TEST_EMAIL_OVERRIDE` | `matt@greenpropertymgt.com` |
| `TEST_MODE` | `TRUE` |

Run **Health Check** — it should now announce *TEST MODE IS ARMED* and echo your rows
and override address. If it says STOP instead, `TEST_MODE` didn't take: it must read
`TRUE` as text or a real checkbox, not `Yes` or `1`.

### 5. Dry parse
Apps Script editor → run `testParseStatement()`. Read-only: parses and reports, writes
nothing, moves nothing. Confirm the period, the charge count, and that every cardholder
heading came back exactly as printed **before** letting it write.

### 6. Part 1 — Parse Statement
Menu → **Part 1 — Parse Statement**. Writes the Statements row and the Reconciliation
tab, moves the PDF to `Processed/`.

### 7. Assign GL codes
Menu → **Assign GL Codes** — queue is narrowed to your test rows only.

### 8. The human gate
On the Reconciliation tab, work the table below: type the Override Amount on the near
miss; narrow **Receipt Row (col H) to one row** then tick Approve on the double match.

### 9. Part 1 — Re-run Matching
Free, unlimited. Confirm the override was consumed and cleared, and that matched rows
went `Pending → Ready`.

### 10. Chase emails
Menu → **Send Chase Emails**. Everything lands in your inbox.

### 11. Force the resume path
Apps Script editor → `forceAttachResumeForTesting()`. Sets `ATTACH_BUDGET_MS_OVERRIDE=1`
so every execution attaches exactly one receipt and then chains — a 3-receipt owner then
exercises the same resume path a 40-receipt one would. **The 200-receipt run will hit
this**, and it's the guard that stops a timeout becoming a duplicate invoice.

### 12. Part 2 — Invoice & Send
Menu → **Part 2 — Invoice & Send**. Expect two invoices, chained across several
executions. Watch the log for `TEST MODE: snapshot narrowed from N to 6` and the two
`DRY RUN` archive lines.

### 13. Verify
Apps Script editor → `clearAttachResumeTesting()`, then menu → **Test — Verify Run**.

### 14. Revert
Menu → **Test — Revert Run**, then work its printed checklist.

---

## Expected results

### Reconciliation tab, after step 6

| Ref | Cardholder | Status | Then do this |
|---|---|---|---|
| 8801 | GREEN,MARTIN W | `Matched` | nothing — auto-promotes to Ready |
| 8802 | GREEN,MARTIN W | `Matched` | nothing |
| 8803 | GREEN,MARTIN W | `Near miss` | type the charge amount into **Override Amount (col N)** |
| 8804 | GREEN,MARTIN W | `Missing receipt` | nothing — this is what feeds the chase email |
| 8805 | CROSS,LAURA | `Matched` | nothing |
| 8806 | CROSS,LAURA | `Matched` | nothing |
| 8807 | CROSS,LAURA | `Double Matched` | narrow **Receipt Row (col H)** to one row, then tick **Approve** |

### After step 9 (Re-run Matching)

- Override Amount cell is **blank again** — consumed, and a `Reconciliation: `-prefixed
  note landed in that row's col R. It can never be spent twice.
- Ref 8803's row now reads `Matched`, having become an ordinary exact match.
- Ref 8807 reads `Matched (approved)` and the tick persists.
- Test rows R1–R5 are `Ready`. **R6 is still `Pending`** — it has no statement charge.

### After step 12 (Part 2)

| What | Expected |
|---|---|
| Test rows R1–R5 | `Sent`, green, with an invoice # and date |
| Test row R6 | **still `Pending`** — the standing rail holding |
| Distinct invoice #s | exactly **2** |
| Every other row in the sheet | status and GL **unchanged** |
| Drive | Current Statement is the **same folder**, same name, nothing moved |
| Log | `TEST MODE — DRY RUN: would rename …` and the planned archive moves |

### Check by hand — code can't see these

1. **QBO**: two invoices, one per owner. One line per receipt, property header on its own
   line, the itemized block beneath it, correct total. Multi-property owner's lines are
   grouped by property.
2. **QBO attachments**: the receipt images actually attached to each invoice.
3. **Your inbox**: summary email, chase email(s), and the receipt packet — the packet
   sectioned by owner showing GL code + property/unit + vendor + date.
4. **Nobody else's inbox**: nothing at Alaina, Laura, or any owner.
5. **Drive**: open `Current Statement` and confirm every untested receipt is still there.

---

## Revert

`revertTestRun()` restores from the snapshot rather than recomputing what "should" be
there, so a bug in the run can't propagate into a plausible-looking wrong revert. It is
idempotent.

It restores: the test rows' cols I, K, O, P, Q, R, T and the status background; and
Merchant Map, GL Memory, Statements and Reconciliation verbatim — including **in-place**
mutations like GL Memory's `Times Seen`, which a "delete rows past the old count" trim
would silently keep.

Then, by hand:

1. Delete the two test invoices in QuickBooks.
2. Config: `TEST_MODE` → `FALSE`.
3. Config: **clear `TEST_EMAIL_OVERRIDE`.** Leaving it set is the one mistake that
   makes a real run look successful while nothing reaches an owner.
4. Delete the synthetic statement PDF from `Processed/`.
5. Confirm `ATTACH_BUDGET_MS_OVERRIDE` is gone (`clearAttachResumeTesting()`).
6. **Health Check** — Ready-but-unbilled should read 0, and the TEST_MODE banner should
   be gone.

---

## Notes

- The synthetic PDF is text-extractable, whereas real FNBM statements defeat text
  extraction (custom font encoding). Both go through Claude's PDF document block, so the
  pipeline is identical — but this test does not re-prove the parser against the harder
  real-world encoding. That part was already confirmed on a real statement.
- `_undoStatementParse()` (`statementParse.js:209`) is the pre-existing Part 1 rollback;
  `revertTestRun()` covers the same ground plus the Submissions and learned-table state.
