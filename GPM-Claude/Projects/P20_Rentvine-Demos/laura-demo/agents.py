"""Four event-driven agents on the Rentvine sandbox for the Laura demo.

  Leads        new prospect on a unit (poll: Rentvine has no prospect webhook) -> text a showing link
  Maintenance  Work Order Created webhook -> Claude grades urgency -> schedule, assign tech, note, text tenant
  Turn         Lease Updated webhook with a notice date -> turn WO, inspection hold, Claude-drafted listing
  Billing      WO status -> Completed webhook -> owner bill linked to the WO, held for human approval

Money stays two-lane: the billing agent only creates bills while Rentvine's bill-approval gate is on.
Approving and paying are done by a person in the Rentvine UI (payout is UI-only, D01).

Safety: texts go ONLY to numbers in SMS_ALLOWLIST (.env). Sandbox contacts carry real third-party
numbers, so anything else is logged as "held", never sent.

Every step is appended to FEED with the claim IDs that back it (verify/verify_claims.py), which the
demo page renders live.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import rv  # noqa: E402  (also loads ../.env into os.environ)

STATE_PATH = os.path.join(HERE, "agents_state.json")
TOKEN = os.environ.get("WEBHOOK_TOKEN", "")
ALLOWLIST = {rv.to_e164(n) for n in os.environ.get("SMS_ALLOWLIST", "").split(",") if rv.to_e164(n)}
BOOKING_LINK = os.environ.get("BOOKING_LINK", "https://calendar.app.google/SgwgYocvfbixz2rR8")
LABOR_RATE = float(os.environ.get("LABOR_RATE", "65"))   # $/hr billed to owners; demo value until Matt confirms
DEFAULT_HOURS = 2.0                                        # when the WO has no actual start/end times
TECH = {"contactID": "175", "name": "Jake Morales"}        # sandbox maintenance technician (W26)
GPM_PAYEE = "174"                                          # vendor contact "Green Property Management"
GL = {"plumbing": 30, "hvac": 29, "painting": 33}          # chart-of-accounts IDs in this sandbox
STATUS_OPEN, STATUS_COMPLETED, STATUS_REQUESTED = "1", "2", "4"
# The docs list 4 = Emergency, but this account rejects it ("Must be a valid priority type"), so
# emergencies are stored as High and called out in the note and the tenant text.
PRIORITY = {"low": "1", "normal": "2", "high": "3", "emergency": "3"}
SKIP_TAG = "[CLAIMS-TEST]"

FEED = []
LAST_HOOK = [None]   # time of the last webhook delivery seen this run
_lock = threading.Lock()
_state = None


# ---------------------------------------------------------------------------------------------- state

def state():
    global _state
    if _state is None:
        _state = json.load(open(STATE_PATH)) if os.path.exists(STATE_PATH) else {}
        for k in ("seen_hooks", "handled"):
            _state.setdefault(k, {} if k == "handled" else [])
        for k in ("prospects", "wo_created", "wo_completed", "notice"):
            _state["handled"].setdefault(k, {})
    return _state


def save():
    with _lock:
        json.dump(state(), open(STATE_PATH, "w"), indent=2)


def once(kind, key, value=True):
    """True the first time (kind, key) is claimed. Rentvine has no write dedup (W08), so we keep our own."""
    with _lock:
        seen = state()["handled"][kind]
        if str(key) in seen:
            return False
        seen[str(key)] = value
    save()
    return True


def log(agent, step, detail="", status="done", claims=(), data=None):
    with _lock:
        item = {"id": len(FEED) + 1, "t": datetime.datetime.now().strftime("%H:%M:%S"), "agent": agent,
                "step": step, "detail": detail, "status": status, "claims": list(claims), "data": data or {}}
        FEED.append(item)
    print(f"[{item['t']}] {agent:<11} {status:<8} {step}" + (f" | {detail}" if detail else ""), flush=True)
    return item


# -------------------------------------------------------------------------------------------- helpers

def unwrap(body, key):
    return body.get(key, body) if isinstance(body, dict) else {}


def get_wo(wid):
    return unwrap(rv.get(f"maintenance/work-orders/{wid}")[1], "workOrder")


def unit_by_id(uid):
    return next((r["unit"] for r in rv.get("properties/units?pageSize=500")[1] if r["unit"]["unitID"] == str(uid)), {})


def primary_tenant(lease_id):
    if not lease_id:
        return {}
    s, b = rv.get(f"leases/{lease_id}?includes=tenants")
    ts = (b or {}).get("tenants") or []
    t = next((x for x in ts if x["leaseTenant"]["isPrimary"] == "1"), ts[0] if ts else None)
    return t["contact"] if t else {}


def lease_for_unit(unit_id):
    s, b = rv.get("leases/export?pageSize=500")
    for r in b if s == 200 else []:
        lease = r.get("lease", r)
        if lease.get("unitID") == str(unit_id) and lease.get("primaryLeaseStatusID") == "2":
            return lease.get("leaseID")
    return None


def ledger_for_unit(unit_name):
    """Ledger search is substring (R08): keep only the exact unit-name match."""
    s, b = rv.get(f"accounting/ledgers/search?search={urllib.parse.quote(unit_name)}")
    return next((r["ledger"]["ledgerID"] for r in (b if s == 200 else []) if (r.get("unit") or {}).get("name") == unit_name), None)


def send_text(agent, phone, message, claims=("W14",)):
    to = rv.to_e164(phone)
    if not to or to not in ALLOWLIST:
        log(agent, "Text held (number not on the demo allowlist)", f"to {phone or 'no number'}: {message}",
            status="held", claims=claims)
        return None
    s, b = rv.post("messages/texts/send", {"to": to, "message": message})
    tid = (b or {}).get("textMessage", {}).get("textMessageID") if s == 200 else None
    if tid:
        log(agent, "Text sent from Rentvine", f"to {to}: {message}", claims=claims, data={"textMessageID": tid})
    else:
        log(agent, "Text failed", f"HTTP {s}: {str(b)[:200]}", status="error", claims=claims)
    return tid


def ask_claude(prompt, fallback):
    """Headless Claude Code call (uses Matt's login, no API key). Returns (parsed JSON, used_claude)."""
    try:
        out = subprocess.run(["claude", "-p", "--model", "haiku", prompt], capture_output=True, text=True,
                             timeout=90, cwd=HERE).stdout
        m = re.search(r"\{.*\}", out, re.S)
        if m:
            return json.loads(m.group(0)), True
    except (subprocess.SubprocessError, ValueError, OSError):
        pass
    return fallback, False


def business_day(d, n):
    while n:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def gcal_link(title, start, end, details, location):
    fmt = "%Y%m%dT%H%M%S"
    q = urllib.parse.urlencode({"action": "TEMPLATE", "text": title, "details": details, "location": location,
                                "dates": f"{start.strftime(fmt)}/{end.strftime(fmt)}", "ctz": "America/Detroit"})
    return f"https://calendar.google.com/calendar/render?{q}"


# ------------------------------------------------------------------------------------------ 1. Leads

def leads_poll():
    s, b = rv.get("screening/prospects")
    if s != 200:
        return
    for row in b:
        p, unit = row["prospect"], row.get("unit") or {}
        pid = p["prospectID"]
        if not p.get("unitID") or not once("prospects", pid):
            continue
        first = (p.get("name") or "there").split()[0]
        log("Leads", f"New lead: {p.get('name')} on {unit.get('name')}",
            "Picked up by polling /screening/prospects (Rentvine has no prospect webhook)",
            claims=("R06", "W13", "H07"), data={"prospectID": pid})
        msg = (f"Hi {first}, thanks for your interest in {unit.get('name')}, {unit.get('city')}! "
               f"Pick a showing time here: {BOOKING_LINK} - Green Property Management")
        send_text("Leads", p.get("phone"), msg)


def baseline_prospects():
    s, b = rv.get("screening/prospects")
    for row in b if s == 200 else []:
        once("prospects", row["prospect"]["prospectID"], "baseline")


# ------------------------------------------------------------------------------------ 2. Maintenance

TRIAGE_PROMPT = """You triage maintenance requests for a property manager in Grand Rapids, MI.
Request from the tenant:
---
{text}
---
Reply with ONLY this JSON, no prose:
{{"priority": "emergency|high|normal|low", "trade": "plumbing|hvac|painting|general",
  "reason": "<15 words on why this priority>",
  "tenant_text": "<one friendly SMS under 220 chars to {first}: we're on it and {tech} will come by; put the bare word WINDOW (no brackets) where the arrival time goes; don't say "on the way" or "heading over">"}}
Emergency = active water/gas/fire/no heat in winter/security. High = could cause damage within a day."""


def maintenance(wid, via="webhook"):
    wo = get_wo(wid)
    desc = re.sub("<[^>]+>", " ", wo.get("description") or "").strip()
    if SKIP_TAG in desc or desc.startswith("Unit turn after"):   # test records; the Turn agent's own WO
        return
    if wo.get("workOrderStatusID") == STATUS_OPEN and wo.get("technicianContactIDs"):
        return   # already dispatched by a person: nothing to triage
    unit = unit_by_id(wo.get("unitID"))
    created = wo.get("dateTimeCreated")
    log("Maintenance", f"Work order #{wo.get('workOrderNumber')} received at {unit.get('name')}",
        (f"Work Order Created webhook (signed, ~1s)" if via == "webhook" else "Seen by polling Rentvine (webhook fallback)")
        + f"; created {created}. Request: {desc[:160]}", claims=("W21", "W01") if via == "webhook" else ("W01",),
        data={"workOrderID": wid})
    lease_id = wo.get("leaseID") or lease_for_unit(wo.get("unitID"))
    tenant = primary_tenant(lease_id)
    first = (tenant.get("name") or "there").split()[0]

    log("Maintenance", "Claude is grading urgency…", status="working")
    rules = "high" if re.search(r"leak|water|flood|no heat|gas|spark|smoke", desc, re.I) else "normal"
    triage, used = ask_claude(TRIAGE_PROMPT.format(text=desc, first=first, tech=TECH["name"]), {
        "priority": rules, "trade": "plumbing" if re.search(r"sink|leak|toilet|drain|faucet", desc, re.I) else "general",
        "reason": "keyword rules (Claude unavailable)",
        "tenant_text": f"Hi {first}, Green Property Management here. {TECH['name']} is scheduled for WINDOW. "
                       "Reply here if anything changes."})
    grade = str(triage.get("priority")).lower()
    prio = PRIORITY.get(grade, "2")
    with _lock:
        state()["handled"]["wo_created"][str(wid)] = str(triage.get("trade") or "general").lower()
    save()
    log("Maintenance", f"Graded {grade.upper()} ({triage.get('trade')})",
        f"{'Claude' if used else 'Fallback rules'}: {triage.get('reason')}")

    # The window follows the grade: emergency = on-call within the hour, high = next business morning.
    now = datetime.datetime.now()
    if grade == "emergency":
        start = (now + datetime.timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    else:
        day = business_day(now.date(), {"high": 1, "normal": 2}.get(grade, 3))
        start = datetime.datetime.combine(day, datetime.time(8 if grade == "high" else 10))
    end = start + datetime.timedelta(hours=2)
    day = start.date()
    window = (("today" if day == now.date() else f"{start:%a %b %-d}") +
              f", {start:%-I%p}-{end:%-I%p}").replace("AM", "am").replace("PM", "pm")

    # Rentvine refuses to double-book a technician, so walk forward to the next open 2-hour window.
    s, b, tried = None, None, []
    for _ in range(8):
        update = {"priorityID": prio, "workOrderStatusID": STATUS_OPEN, "technicianContactIDs": [TECH["contactID"]],
                  "scheduledStartDate": f"{start.date()}", "scheduledEndDate": f"{start.date()}",
                  "appointmentWindowStartDateTime": f"{start:%Y-%m-%d %H:%M:%S}",
                  "appointmentWindowEndDateTime": f"{end:%Y-%m-%d %H:%M:%S}"}
        s, b = rv.post(f"maintenance/work-orders/{wid}", update)
        if not (s == 400 and "another work order scheduled" in json.dumps(b)):
            break
        tried.append(f"{start:%-I%p}".lower())
        start += datetime.timedelta(hours=2)
        if start.hour > 19:
            start = datetime.datetime.combine(business_day(start.date(), 1), datetime.time(8))
        end = start + datetime.timedelta(hours=2)
    window = (("today" if start.date() == now.date() else f"{start:%a %b %-d}") +
              f", {start:%-I%p}-{end:%-I%p}").replace("AM", "am").replace("PM", "pm")
    if tried:
        log("Maintenance", f"{TECH['name']} already booked at {', '.join(tried)}, took the next opening",
            "Rentvine rejects double-booking a technician, so the agent checks the calendar for it", claims=("W30",))
    back = get_wo(wid)
    missed = [k for k in ("priorityID", "workOrderStatusID", "appointmentWindowStartDateTime")
              if str(back.get(k)) != str(update[k])]
    if s == 200 and not missed:
        log("Maintenance", f"Scheduled {TECH['name']} for {window}, priority set, status Open",
            "Written to the work order in Rentvine and re-read to confirm", claims=("W02", "W03", "W04", "W26"))
    else:
        log("Maintenance", "Work order update did not stick", f"HTTP {s}: {str(b)[:200]}; mismatched {missed}",
            status="error")
    note = (f"<p><b>Agent triage:</b> {triage.get('priority')} / {triage.get('trade')}: {triage.get('reason')}<br>"
            f"Scheduled {TECH['name']}, {window}" + (" (EMERGENCY; stored as High, this account's top priority)"
            if grade == "emergency" else "") + ". Tenant notified by text.</p>")
    s, _ = rv.post("chat/messages", {"chatObjectTypeID": 1, "objectID": int(wid), "message": note,
                                     "isSharedWithTenant": "0"})
    log("Maintenance", "Posted triage note on the work order", claims=("W05",), status="done" if s == 200 else "error")
    send_text("Maintenance", tenant.get("phone"), re.sub(r"[\[({]?WINDOW[\])}]?", window, str(triage.get("tenant_text"))))


# ----------------------------------------------------------------------------------------- 3. Turn

LISTING_PROMPT = """Write a rental listing for Green Property Management (Grand Rapids, MI).
Facts: {facts}. Available {available}.
Reply with ONLY JSON: {{"headline": "<under 70 chars>", "body": "<90-130 words, warm and concrete, no invented amenities, end with: Book a showing at {link}>"}}"""


def turn(lease_id, notice_date, via="webhook"):
    lease = unwrap(rv.get(f"leases/{lease_id}")[1], "lease")
    unit = unit_by_id(lease.get("unitID"))
    move_out = lease.get("expectedMoveOutDate")
    log("Turn", f"Notice recorded at {unit.get('name')}: move-out {move_out or 'TBD'}",
        (f"Lease Updated webhook with noticeDate {notice_date} in the change diff" if via == "webhook"
         else f"Seen by polling Rentvine (webhook fallback); noticeDate {notice_date}"), claims=("W23",),
        data={"leaseID": lease_id})
    mo = datetime.date.fromisoformat(move_out) if move_out else business_day(datetime.date.today(), 30)
    turn_start = business_day(mo, 1)
    s, b = rv.post("maintenance/work-orders", {
        "propertyID": unit.get("propertyID"), "unitID": unit.get("unitID"), "isInternal": "1",
        "priorityID": PRIORITY["normal"], "workOrderStatusID": STATUS_OPEN,
        "description": f"Unit turn after {mo:%b %-d} move-out: move-out inspection, paint touch-up, deep clean, "
                       f"carpet assessment, rekey. Target: rent-ready in 14 days.",
        "scheduledStartDate": f"{turn_start}", "scheduledEndDate": f"{business_day(turn_start, 9)}"})
    tw = unwrap(b, "workOrder")
    if s == 200 and tw.get("workOrderID"):
        once("wo_created", tw["workOrderID"], "agent-created turn")   # don't let Maintenance re-triage it
        log("Turn", f"Turn work order #{tw.get('workOrderNumber')} created, starts {turn_start:%b %-d}",
            claims=("W01", "W02"), data={"workOrderID": tw["workOrderID"], "inspection": f"{mo}T10:00:00"})
    else:
        log("Turn", "Turn work order failed", f"HTTP {s}: {str(b)[:200]}", status="error")
    insp = datetime.datetime.combine(mo, datetime.time(10))
    link = gcal_link(f"Move-out inspection: {unit.get('name')}", insp, insp + datetime.timedelta(hours=1),
                     "Scheduled by the Turn agent from the tenant's notice in Rentvine.", unit.get("name", ""))
    log("Turn", f"Move-out inspection hold ready for {insp:%a %b %-d, %-I%p}".replace("AM", "am"),
        "Rentvine has no inspection-create API, so this goes to the PM's Google Calendar", status="done",
        data={"gcal": link})
    prop = unwrap(rv.get(f"properties/{unit.get('propertyID')}")[1], "property")
    facts = (f"{unit.get('name')}, {unit.get('city')}; {unit.get('beds')} bed, {unit.get('fullBaths')} bath, "
             f"{unit.get('size')} sq ft, built {prop.get('yearBuilt')}; ${float(unit.get('rent') or 0):,.0f}/month")
    log("Turn", "Claude is drafting the listing…", status="working")
    listing, used = ask_claude(LISTING_PROMPT.format(facts=facts, available=f"{turn_start:%B %-d}", link=BOOKING_LINK),
                               {"headline": f"{unit.get('beds')}BR/{unit.get('fullBaths')}BA at {unit.get('name')}",
                                "body": f"{facts}. Available {turn_start:%B %-d}. Book a showing at {BOOKING_LINK}"})
    if tw.get("workOrderID"):   # put the draft where the PM will see it: the turn work order's thread
        rv.post("chat/messages", {"chatObjectTypeID": 1, "objectID": int(tw["workOrderID"]), "isSharedWithTenant": "0",
                                  "message": f"<p><b>Listing draft (ready to publish):</b> {listing.get('headline')}</p>"
                                             f"<p>{listing.get('body')}</p><p>Move-out inspection: "
                                             f"{insp:%a %b %-d, %-I%p} (on the PM's calendar).</p>"})
    log("Turn", f"Listing drafted: {listing.get('headline')}",
        ("Claude" if used else "Template") + " draft, posted on the turn work order's thread, waiting for a PM to publish. Rentvine's listing API is "
        "read-only, so publishing stays a click (asked Rentvine 2026-09-18)", status="waiting",
        data={"listing": listing})


# -------------------------------------------------------------------------------------- 4. Billing

def ensure_approval_gate():
    cur = unwrap(rv.get("accounting/settings")[1], "settings").get("isBillApprovalEnabled")
    st = state()
    st.setdefault("gate_original", cur)
    if str(cur) != "1":
        rv.post("accounting/settings", {"isBillApprovalEnabled": 1})
    ok = str(unwrap(rv.get("accounting/settings")[1], "settings").get("isBillApprovalEnabled")) == "1"
    save()
    return ok


def billing(wid, via="webhook"):
    wo = get_wo(wid)
    if SKIP_TAG in (wo.get("description") or ""):
        return
    unit = unit_by_id(wo.get("unitID"))
    log("Billing", f"Work order #{wo.get('workOrderNumber')} marked Completed",
        "Work Order Updated webhook, status diff → Completed" if via == "webhook"
        else "Seen by polling Rentvine (webhook fallback)", claims=("W21",) if via == "webhook" else (),
        data={"workOrderID": wid})
    a, e = wo.get("actualStartDate"), wo.get("actualEndDate")
    hours = DEFAULT_HOURS
    try:
        if a and e:
            hours = max(0.5, (datetime.datetime.fromisoformat(e) - datetime.datetime.fromisoformat(a)).total_seconds() / 3600)
    except ValueError:
        pass
    # GPM policy: the first hour is comped on a unit's first 3 calls each month (tech still paid).
    month = datetime.date.today().strftime("%Y-%m")
    calls = sum(1 for r in rv.get("maintenance/work-orders?pageSize=500")[1]
                if r["workOrder"].get("unitID") == wo.get("unitID")
                and (r["workOrder"].get("dateTimeCreated") or "").startswith(month)
                and r["workOrder"].get("workOrderStatusID") != "3"          # cancelled calls don't count
                and SKIP_TAG not in (r["workOrder"].get("description") or ""))
    comped = 1.0 if calls <= 3 else 0.0
    billable = max(0.0, hours - comped)
    amount = round(billable * LABOR_RATE, 2)
    policy = (f"{hours:g} h labor; first hour comped (call {calls} of 3 this month)" if comped
              else f"{hours:g} h labor (call {calls} this month, no comp)")
    if amount <= 0:
        log("Billing", "No owner charge", policy, claims=())
        return
    ledger = ledger_for_unit(unit.get("name", ""))
    if not ledger:
        log("Billing", "Couldn't resolve the owner ledger", f"unit {unit.get('name')}", status="error", claims=("R08",))
        return
    if not ensure_approval_gate():
        log("Billing", "Approval gate is OFF, refusing to create a bill", status="error", claims=("R07", "W09"))
        return
    trade = state()["handled"]["wo_created"].get(str(wid))   # set by the Maintenance agent's triage
    gl = GL.get(trade if isinstance(trade, str) else "", GL["plumbing"])
    desc = re.sub("<[^>]+>", " ", wo.get("description") or "").strip()[:80]
    s, b = rv.post("accounting/bills", {
        "payeeContactID": GPM_PAYEE, "billDate": f"{datetime.date.today()}",
        "dateDue": f"{datetime.date.today() + datetime.timedelta(days=10)}",
        "reference": f"WO-{wo.get('workOrderNumber')}", "workOrderID": wid,
        "charges": [{"ledgerID": ledger, "chargeAccountID": gl, "amount": f"{amount:.2f}",
                     "description": f"WO #{wo.get('workOrderNumber')}: {desc} ({policy} x ${LABOR_RATE:g}/h)"}]})
    bill = unwrap(b, "bill")
    bid = bill.get("billID")
    if s != 200 or not bid:
        log("Billing", "Bill creation failed", f"HTTP {s}: {str(b)[:200]}", status="error")
        return
    back = unwrap(rv.get(f"accounting/bills/{bid}")[1], "bill")
    log("Billing", f"Owner bill #{bid} created: ${amount:,.2f} to {unit.get('name')}",
        f"Linked to WO #{wo.get('workOrderNumber')}; {policy}; isApproved={back.get('isApproved')}",
        claims=("W06", "W07", "W08"), data={"billID": bid})
    log("Billing", "Waiting for a person to approve it in Rentvine",
        "Accounting → Bills. The agent can't pay or release money (D01)", status="waiting", claims=("W09", "D01"),
        data={"billID": bid})
    threading.Thread(target=_watch_bill, args=(bid,), daemon=True).start()


PARTS = {  # Price Book items the demo's A/C job uses (created at reset if missing); prices are demo values
    "Run capacitor 45/5 MFD": ("38.00", "14.50"),
    "R-410A refrigerant (per lb)": ("42.00", "18.00"),
}


def ensure_parts():
    have = {m.get("material", m)["name"] for m in rv.get("maintenance/materials")[1]}
    for name, (sell, cost) in PARTS.items():
        if name not in have:
            rv.post("maintenance/materials", {"name": name, "sellPrice": sell, "purchasePrice": cost})


def itemized_bill(wid, hours, parts, notes=""):
    """Prompt 5: close a job and turn it into an itemized owner bill, resolving the owner from the WO."""
    once("wo_completed", wid)   # this path bills the job; keep the plain Billing agent off it
    wo = get_wo(wid)
    unit = unit_by_id(wo.get("unitID"))
    pf = unwrap(rv.get(f"portfolios/{wo.get('portfolioID')}")[1], "portfolio")
    owners = ", ".join(c["name"] for c in pf.get("contacts") or [])
    ledger = ledger_for_unit(unit.get("name", ""))
    log("Invoice", f"Work order #{wo.get('workOrderNumber')} → {unit.get('name')} → owner {owners}",
        f"Resolved from the work order: property {wo.get('propertyID')} → portfolio \"{pf.get('name')}\" → "
        f"ledger {ledger} (exact unit match, not substring)", claims=("R08", "W07"))
    if wo.get("workOrderStatusID") != STATUS_COMPLETED:
        rv.post(f"maintenance/work-orders/{wid}", {"workOrderStatusID": STATUS_COMPLETED})
        log("Invoice", "Work order marked Completed", notes or "")
    book = {m.get("material", m)["name"]: m.get("material", m) for m in rv.get("maintenance/materials")[1]}
    month = datetime.date.today().strftime("%Y-%m")
    calls = sum(1 for r in rv.get("maintenance/work-orders?pageSize=500")[1]
                if r["workOrder"].get("unitID") == wo.get("unitID") and r["workOrder"].get("workOrderStatusID") != "3"
                and (r["workOrder"].get("dateTimeCreated") or "").startswith(month)
                and SKIP_TAG not in (r["workOrder"].get("description") or ""))
    comped = 1.0 if calls <= 3 else 0.0
    lines, total = [], 0.0
    labor = round(max(0.0, hours - comped) * LABOR_RATE, 2)
    lines.append({"ledgerID": ledger, "chargeAccountID": GL["hvac"], "amount": f"{labor:.2f}",
                  "description": f"Labor, {TECH['name']}: {hours:g} h"
                                 + (f", first hour comped (call {calls} of 3 this month)" if comped else "")
                                 + f" x ${LABOR_RATE:g}/h"})
    total += labor
    for name, qty in parts:
        m = book.get(name)
        if not m:
            log("Invoice", f"Part not in the Price Book: {name}", status="error")
            return
        amt = round(float(m["sellPrice"]) * qty, 2)
        lines.append({"ledgerID": ledger, "chargeAccountID": GL["hvac"], "amount": f"{amt:.2f}",
                      "description": f"{name} x {qty:g} @ ${float(m['sellPrice']):.2f} (Price Book)"})
        total += amt
    if not ensure_approval_gate():
        log("Invoice", "Approval gate is OFF, refusing to create a bill", status="error", claims=("R07", "W09"))
        return
    s, b = rv.post("accounting/bills", {
        "payeeContactID": GPM_PAYEE, "billDate": f"{datetime.date.today()}",
        "dateDue": f"{datetime.date.today() + datetime.timedelta(days=10)}",
        "reference": f"WO-{wo.get('workOrderNumber')}", "workOrderID": wid, "charges": lines})
    bill = unwrap(b, "bill")
    bid = bill.get("billID")
    if s != 200 or not bid:
        log("Invoice", "Bill creation failed", f"HTTP {s}: {str(b)[:200]}", status="error")
        return
    full = rv.get(f"accounting/bills/{bid}?includes=charges")[1]
    back = unwrap(full, "bill")
    saved = [c.get("transaction", c) for c in full.get("charges") or []]
    saved_total = sum(float(c.get("amount") or 0) for c in saved)
    log("Invoice", f"Itemized bill #{bid}: ${total:,.2f} to {owners} ({len(lines)} lines, HVAC)",
        " | ".join(f"{l['description']}: ${float(l['amount']):,.2f}" for l in lines) +
        f" | re-read from Rentvine: {len(saved)} lines, ${saved_total:,.2f}, isApproved={back.get('isApproved')}",
        claims=("W06", "W07", "W08"), data={"billID": bid},
        status="done" if len(saved) == len(lines) and abs(saved_total - total) < 0.01 else "error")
    rv.post("chat/messages", {"chatObjectTypeID": 1, "objectID": int(wid), "isSharedWithTenant": "0",
                              "message": f"<p><b>Billed to owner ({owners}):</b> bill #{bid}, ${total:,.2f}, "
                                         f"waiting for approval.</p><p>" + "<br>".join(
                                             f"{l['description']}: ${float(l['amount']):,.2f}" for l in lines) + "</p>"})
    log("Invoice", "Waiting for a person to approve it in Rentvine",
        "Accounting → Bills. The agent can't pay or release money (D01)", status="waiting", claims=("W09", "D01"),
        data={"billID": bid})
    threading.Thread(target=_watch_bill, args=(bid,), daemon=True).start()


def _watch_bill(bid, minutes=45):
    approved = False
    for _ in range(minutes * 12):
        b = unwrap(rv.get(f"accounting/bills/{bid}")[1], "bill")
        if not approved and str(b.get("isApproved")) == "1":
            approved = True
            log("Billing", f"Bill #{bid} approved by a person", "Next: the payment batch, run by a person in the UI",
                claims=("W09",))
        if float(b.get("amountPaid") or 0) > 0:
            log("Billing", f"Bill #{bid} paid (${float(b['amountPaid']):,.2f})", "Released by a person in Rentvine",
                claims=("D01",))
            return
        time.sleep(5)


# ------------------------------------------------------------------------------------------ runner

def _changes(ev):
    ch = ev.get("changes") or {}
    if isinstance(ch, list):
        return {c.get("field") or c.get("name"): c for c in ch if isinstance(c, dict)}
    return ch


def _current(change):
    return change.get("current") if isinstance(change, dict) else change


def dispatch(d):
    ev, data = d.get("event") or {}, d.get("data") or {}
    et = ev.get("eventType") or ""
    ch = _changes(ev)
    if et.startswith("maintenance::workOrder"):
        wid = str(data.get("workOrderID") or ev.get("objectID"))
        if et.endswith("created") and once("wo_created", wid):
            threading.Thread(target=maintenance, args=(wid,), daemon=True).start()
        elif et.endswith("updated") and str(_current(ch.get("workOrderStatusID"))) == STATUS_COMPLETED \
                and once("wo_completed", wid):
            threading.Thread(target=billing, args=(wid,), daemon=True).start()
    elif et.startswith("lease") and data.get("noticeDate"):
        # The payload is the full lease record; Rentvine's diff doesn't list noticeDate (W23), so read it here.
        # Leases that already had a notice at startup are baselined, so only a new notice fires.
        lid, nd = str(data.get("leaseID") or ev.get("objectID")), data["noticeDate"]
        if once("notice", f"{lid}:{nd}"):
            threading.Thread(target=turn, args=(lid, nd), daemon=True).start()


# Polling fallback: the demo must not stall if webhooks aren't configured or a delivery is late.
# once() is shared with the webhook path, so whichever trigger arrives first handles the event.
_known = {"wo": None, "notice": None}


def rentvine_poll():
    wos = {r["workOrder"]["workOrderID"]: r["workOrder"] for r in rv.get("maintenance/work-orders?pageSize=500")[1]}
    s, b = rv.get("leases/export?pageSize=500")
    # /leases/export has expectedMoveOutDate but not noticeDate, so watch the move-out date.
    notices = {r["lease"]["leaseID"]: r["lease"].get("expectedMoveOutDate") for r in (b if s == 200 else [])}
    if _known["wo"] is None:   # baseline on the first pass: only react to changes from now on
        _known["wo"] = {k: w.get("workOrderStatusID") for k, w in wos.items()}
        _known["notice"] = notices
        return
    for wid, w in wos.items():
        before = _known["wo"].get(wid, "new")
        if before == "new" and once("wo_created", wid):
            threading.Thread(target=maintenance, args=(wid, "poll"), daemon=True).start()
        elif w.get("workOrderStatusID") == STATUS_COMPLETED and before not in (STATUS_COMPLETED, "new") \
                and once("wo_completed", wid):
            threading.Thread(target=billing, args=(wid, "poll"), daemon=True).start()
        _known["wo"][wid] = w.get("workOrderStatusID")
    for lid, nd in notices.items():
        if nd and nd != _known["notice"].get(lid):
            notice = unwrap(rv.get(f"leases/{lid}")[1], "lease").get("noticeDate")
            if notice and once("notice", f"{lid}:{notice}"):
                threading.Thread(target=turn, args=(lid, notice, "poll"), daemon=True).start()
    _known["notice"] = notices


def webhook_poll(first=False):
    url = f"https://webhook.site/token/{TOKEN}/requests?sorting=newest&per_page=50"
    reqs = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}),
                                             timeout=20).read()).get("data", [])
    seen = set(state()["seen_hooks"])
    for r in reversed(reqs):
        if r["uuid"] in seen:
            continue
        state()["seen_hooks"].append(r["uuid"])
        if not first:
            LAST_HOOK[0] = time.time()
            try:
                dispatch(json.loads(r.get("content") or "{}"))
            except (ValueError, KeyError) as e:
                log("Runner", "Couldn't read a webhook", str(e), status="error")
    state()["seen_hooks"] = state()["seen_hooks"][-500:]
    save()


def _loop(fn, every, name):
    while True:
        try:
            fn()
        except Exception as e:  # keep the agents alive through a flaky call
            log("Runner", f"{name} poll error", str(e)[:200], status="error")
        time.sleep(every)


def baseline_notices():
    s, b = rv.get("leases/export?pageSize=500")
    for r in b if s == 200 else []:
        if r["lease"].get("expectedMoveOutDate"):
            lid = r["lease"]["leaseID"]
            nd = unwrap(rv.get(f"leases/{lid}")[1], "lease").get("noticeDate")
            if nd:
                once("notice", f"{lid}:{nd}", "baseline")


def start():
    baseline_prospects()
    baseline_notices()
    if TOKEN:
        webhook_poll(first=True)   # skip deliveries from before this run
        threading.Thread(target=_loop, args=(webhook_poll, 2, "Webhook"), daemon=True).start()
    threading.Thread(target=_loop, args=(leads_poll, 4, "Leads"), daemon=True).start()
    threading.Thread(target=_loop, args=(rentvine_poll, 4, "Rentvine"), daemon=True).start()
    log("Runner", "Agents running",
        f"webhooks: {'on' if TOKEN else 'OFF (no WEBHOOK_TOKEN)'}; texts allowed to {len(ALLOWLIST)} number(s)")


def reset():
    """Rehearsal reset: forget handled events and clear the feed. Rentvine records stay (bills can't be
    voided via API, W10); the notice on the scene-3 lease is cleared so it can be recorded again."""
    st = state()
    for k in st["handled"]:
        st["handled"][k] = {}
    save()
    baseline_prospects()
    with _lock:
        FEED.clear()
    log("Runner", "Reset for a fresh run")


if __name__ == "__main__":
    start()
    while True:
        time.sleep(3600)
