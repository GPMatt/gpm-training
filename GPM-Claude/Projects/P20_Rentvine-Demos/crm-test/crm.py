"""P20 basic CRM test: a new Rentvine prospect on a unit triggers an instant text + email.

Trigger: polling GET /screening/prospects. Rentvine webhooks only cover Properties, Units,
Leases, and Work Orders, so there is no prospect webhook; polling is the only option.

Acceptance criteria:
  1. A new prospect on a unit gets exactly one SMS (POST /messages/texts/send) and one email
     (POST /contacts/conversations, logged on the Unit) naming that unit's address.
  2. Re-running sends nothing: processed prospectIDs are kept in crm_state.json, because
     Rentvine has no write dedup.
  3. A prospect with no valid phone gets email only; no email means SMS only; neither means skip.
     A channel that fails is retried next run; a channel that succeeded is never re-sent.
  4. Dry-run is the default. Nothing is sent without --live.

Usage:
  python3 crm.py                      # dry run: show what would be sent
  python3 crm.py --live               # send for every unprocessed prospect
  python3 crm.py --live --watch 30    # keep polling every 30s
  python3 crm.py --new-lead "Name" +16165551234 me@x.com 26   # create a test prospect first
"""
import argparse
import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import rv  # noqa: E402

STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "crm_state.json")
SHOWING_LINK = os.environ.get("SHOWING_LINK", "[showing link TBD]")
OBJ_UNIT = 7


def load_state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {"processed": {}}


def save_state(state):
    json.dump(state, open(STATE, "w"), indent=2)


def compose(prospect, unit):
    first = (prospect.get("name") or "there").split()[0]
    addr = " ".join(x for x in [unit.get("address"), unit.get("address2")] if x)
    where = f"{addr}, {unit.get('city')}"
    sms = (f"Hi {first}, thanks for your interest in {where}! "
           f"Book a showing here: {SHOWING_LINK} - Green Property Management")
    subject = f"Your inquiry about {addr}"
    # Rentvine caps email body at 300 chars.
    email = (f"<p>Hi {first},</p><p>Thanks for your interest in {where}. "
             f"Book a showing: {SHOWING_LINK}</p><p>- Green Property Management</p>")[:300]
    return sms, subject, email


def process(live):
    state = load_state()
    status, rows = rv.get("screening/prospects")
    if status != 200:
        print(f"prospect poll failed: HTTP {status} {rows}")
        return
    for row in rows:
        p, unit = row["prospect"], row.get("unit") or {}
        pid = p["prospectID"]
        done = state["processed"].get(pid, {})
        if done.get("baseline"):
            continue
        if not p.get("unitID"):
            continue  # can't personalize without a unit
        sms, subject, email = compose(p, unit)
        phone, addr = rv.to_e164(p.get("phone")), p.get("email")
        # A channel counts as done only once it has a real Rentvine ID; failures retry next run.
        todo_sms = phone and not str(done.get("sms", "")).isdigit()
        todo_email = addr and not str(done.get("email", "")).isdigit()
        if not (todo_sms or todo_email):
            continue
        print(f"[{pid}] {p.get('name')} -> unit {p['unitID']} ({unit.get('address')})")
        result = dict(done, at=datetime.datetime.now().isoformat(timespec="seconds"))
        if todo_sms:
            print(f"   SMS  -> {phone}: {sms}")
            if live:
                s, b = rv.post("messages/texts/send", {"to": phone, "message": sms})
                result["sms"] = b.get("textMessage", {}).get("textMessageID") if s == 200 else f"HTTP {s}: {b}"
                print(f"        {result['sms']}")
        if todo_email:
            print(f"   EMAIL-> {addr}: {subject}")
            if live:
                s, b = rv.post("contacts/conversations", {
                    "recipients": [addr], "subject": subject, "message": email,
                    # Docs say optional; the live API rejects the call without it.
                    "templateObjectTypeID": OBJ_UNIT,
                    "objectTypeID": OBJ_UNIT, "objectID": int(p["unitID"])})
                result["email"] = (b.get("emailConversation", b).get("emailConversationID")
                                   if s == 200 and isinstance(b, dict) else f"HTTP {s}: {b}")
                print(f"        {result['email']}")
        if live:
            state["processed"][pid] = result
            save_state(state)  # save per prospect so a crash mid-run never double-texts
    if not live:
        print("(dry run - nothing sent; add --live)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--watch", type=int, metavar="SECONDS")
    ap.add_argument("--new-lead", nargs=4, metavar=("NAME", "PHONE", "EMAIL", "UNIT_ID"))
    ap.add_argument("--mark-existing", action="store_true",
                    help="mark every current prospect processed without sending (baseline)")
    a = ap.parse_args()
    if a.mark_existing:
        state = load_state()
        _, rows = rv.get("screening/prospects")
        for row in rows:
            state["processed"].setdefault(row["prospect"]["prospectID"], {"baseline": True})
        save_state(state)
        print(f"baselined {len(rows)} existing prospects")
        return
    if a.new_lead:
        name, phone, email, unit = a.new_lead
        s, b = rv.post("screening/prospects", {"name": name, "phone": rv.to_e164(phone),
                                                "email": email, "unitID": unit,
                                                "leadSource": "CRM test"})
        pid = b.get("prospect", b).get("prospectID") if isinstance(b, dict) else None
        # Rentvine dedups on email + unit: a repeat returns 200 with prospectID null (verified 2026-09-18).
        print(f"created prospect {pid}" if pid else f"not created (HTTP {s}): already a lead for this email + unit")
    while True:
        process(a.live)
        if not a.watch:
            break
        time.sleep(a.watch)


if __name__ == "__main__":
    main()
