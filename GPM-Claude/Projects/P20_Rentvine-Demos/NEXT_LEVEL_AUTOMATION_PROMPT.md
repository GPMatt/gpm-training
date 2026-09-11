# Prompt: what would read/write API access unlock across GPM's existing automations?

Paste this into a fresh Claude Code session (or hand it to a subagent) run
from the root of the AgenticTerminal repo. It's written to be self-contained
— it doesn't depend on this conversation's memory.

---

I want a candid audit of every automation project GPM (Green Property
Management) has already built, to find where read/write API access — to
Rentvine specifically, and to AppFolio if it has one — would take each one to
the next level of automation, versus where it wouldn't help at all.

**Step 1 — inventory.** Read through `GPM-Claude/Projects/` (every P0x/P1xx
folder) and `GPM-Claude/command-center/` in this repo. For each real project
you find (skip empty/placeholder folders), identify:
- What it does today, in one sentence.
- What its current data source is (manual CSV export, a scheduled email
  report, direct API, a human copy-pasting numbers, etc.) — this is the part
  that matters most; don't just restate the project's purpose.
- Where a human is currently in the loop that an API could remove or shrink.

**Step 2 — check what's actually possible.** Read
`GPM-Claude/Projects/P20_Rentvine-Demos/README.md` for Rentvine's confirmed
working endpoints, quirks, and limits (payout is UI-only, no write dedup,
etc.) — treat that as ground truth for what Rentvine can and can't do, don't
re-derive it. If a project's improvement idea depends on an AppFolio API,
check whether GPM even has API/webhook access on their current AppFolio
plan before assuming it's available (see the CareerPlug integration-landscape
finding for a precedent — some GPM plan tiers don't expose API/Zapier access
at all).

**Step 3 — match opportunities to reality, not wishful thinking.** For each
project from Step 1, write:
- **Read-side win?** Would pulling live data instead of the current
  CSV/manual source measurably shrink the human-in-the-loop step? Be
  specific about which endpoint and which manual step it replaces.
- **Write-side win?** Would being able to write back (create a bill, update
  a work order's schedule, post a payment, etc.) close the loop entirely, or
  does it hit a wall Rentvine can't cross (e.g. payout execution is UI-only,
  so "fully automated invoicing" still ends with a human running a check
  batch no matter what you build)?
- **Verdict:** worth pursuing / not worth pursuing / worth pursuing only if
  [specific blocker] gets resolved. Don't hedge — pick one.

**Step 4 — rank.** Order the findings by realistic impact: which one or two
projects would most benefit from Rentvine (or AppFolio) API integration if
GPM built it next. Call out anything that's already fully covered by the
three demos already planned in `P20_Rentvine-Demos/README.md` (BillBack 2.0,
tech routing, delinquency filing) so we don't duplicate work — focus this
audit on what's NOT already on that list.

Keep the final report tight: a table or short section per project, not a
wall of prose. I want to walk away knowing exactly which 1-2 things to build
next and why, not a survey of everything that's theoretically possible.
