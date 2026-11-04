# Build: Van Audit result email (GAS web app)

You are building one piece of the GPM Van Audit (P17) bin-count rewrite: a Google Apps Script web app that emails the green/red audit result to Matt and Jason the moment a tech finishes an audit. Another session is rewriting the PWA in parallel; do not touch `pwa/` or any SQL. Matt is running `supabase/migration_2026-11-04_bin_count_audit.sql` in the Supabase SQL Editor; read it first, it defines every table you query.

## Where it lives
- Existing clasp-linked project: `GPM-Claude/Projects/P17_Van_Audit/sync-live/` (only `Code.js` today). Add a NEW file `AuditEmail.js`. Don't restructure `Code.js`; reuse its `sbConfig()` / `sbGet()` / `sbUpdate()` helpers and `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` script properties (already set).
- Script time zone: America/Detroit.
- After every edit: `clasp push` right away (standing rule). First deploy as a web app: Execute as **me**, access **Anyone**. Later updates need `clasp deploy -i <deploymentId>` or the /exec URL keeps serving old code. Hand Matt the `/exec` URL at the end; the PWA needs it.
- When you ask Matt to run any function, say which file it's in (e.g. "run `testAuditEmail` in AuditEmail.js").

## Contract with the PWA
- PWA sends `POST <exec url>` with body `{"session_id":"<uuid>"}`, `Content-Type: text/plain` (no CORS preflight). It doesn't depend on the response, but return JSON `{ok, sent, result}` or `{ok:false, error}`.
- Trust ONLY the session_id. Read everything else from Supabase with the service-role key. Never build email content from the request body.
- Only send when the session is `status='completed'` and `email_sent_at is null`. Wrap the read → send → stamp in `LockService.getScriptLock()`. Set `email_sent_at = now()` immediately after a successful send. A second POST for the same session must send nothing (`sent:false`).

## Data (see the migration)
- `audit_sessions`: van_id, tech_id, completed_at, result ('green'|'red'), red_bins int[], email_sent_at, par_sync_id.
- `vans.label`, `techs.name`.
- `audit_bin_counts` (bins 1-25): expected_total, counted_total, recount_total (null if first count matched), broken_total, result ('ok'|'off').
- `audit_broken_items` (Bin 0): part_id, qty. Join `parts` for name, part_number, bin_number (home bin).
- `audit_lines`: per-part counts, ONLY for parts in bins that were still off after the recount (expected_qty, actual_qty). Join `parts`.
- Use the session's stored `result` / `red_bins`. Do not recompute pass/fail.

## Recipients
- Real vans: To `matt@greenpropertymgt.com, jason@greenpropertymgt.com`.
- Van labelled exactly `Test Van`: To matt@ only, subject prefixed `[TEST] `.

## Email content (plain + simple HTML, phone-readable)
GREEN subject: `🟢 GREEN LIGHT: <Van label> (<Tech>), everything is good`
- Body: van, tech, completed time (e.g. "Tue Nov 4, 2:14 PM").
- If any Bin 0 items: "Broken (Bin 0):" then one line per item: `1 × Toilet - Wax Ring Thick #4027132 (home bin 4)`.

RED subject: `🔴 RED LIGHT: <Van label> (<Tech>), audit bins: 4, 13`
- One section per red bin, ascending:
  - `Bin 4: expected 14, counted 12 (recount 12), broken 1`
  - Per-part table for that bin from audit_lines: Part | # | Expected | Counted | Off by (+/-). Show only lines where counted ≠ expected first, then a muted "rest matched" line count.
  - Broken items whose home bin is this bin, if any.
- Then the Broken (Bin 0) list as in GREEN.
- Footer line: "Jason: follow up with <Tech> and account for the unbilled parts."

## Tests (write them, run them, report output)
- `testAuditEmail()` in AuditEmail.js: takes a hard-coded session_id, builds the email WITHOUT sending, and logs subject + HTML. Matt can point it at a Test Van session.
- Prove de-dupe: POST the same completed Test Van session twice; first `sent:true`, second `sent:false`.
- Prove a non-completed session sends nothing.
- Use ONLY the Test Van for live sends. Never send for a real van while testing.

## Out of scope
PWA changes, SQL/schema changes, restock/AppFolio. If the schema is missing something you need, stop and tell Matt; don't add it.

## Done means
`AuditEmail.js` committed + pushed (AgenticTerminal repo, scope to that file), clasp pushed, web app deployed, `/exec` URL given to Matt, and the three test results pasted back with real output.
