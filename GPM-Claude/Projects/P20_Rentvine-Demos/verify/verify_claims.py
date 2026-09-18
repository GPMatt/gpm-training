"""Rentvine claims ledger: re-test every claim GPM has made about Rentvine, from primary sources.

Why this exists: Rentvine findings have drifted across sessions. Docs gave wrong paths, "ruled out
permanently" turned out wrong twice, and marketing implied features the sandbox doesn't show.
This script is the single place a claim is allowed to be called true. Each claim records where
it came from and gets one of these statuses:

  VERIFIED   tested live against the API (or the docs PDF) and it holds
  REFUTED    tested and it's false; the evidence says what's actually true
  PARTIAL    true with a material caveat (in the evidence)
  BLOCKED    can't complete from the API alone; the evidence says what unblocks it
  HUMAN      only checkable in the UI or by a person; the evidence says exactly how
  VENDOR     Rentvine's own marketing or roadmap, not independently verifiable yet
  EXTERNAL   third-party data such as pricing; the evidence says how to get primary numbers
  ERROR      the test itself broke; don't read it either way

Usage (from P20_Rentvine-Demos/):
  python3 verify/verify_claims.py                  # read-only: safe against ANY account, incl. production
  python3 verify/verify_claims.py --writes         # plus write tests (sandbox only; refuses otherwise)
  python3 verify/verify_claims.py --writes --sms-to +1XXXXXXXXXX
  python3 verify/verify_claims.py --webhook-setup  # get a webhook.site URL to paste into Settings > Webhooks
  python3 verify/verify_claims.py --writes --webhook-token <token>

Everything a write test creates is tagged [CLAIMS-TEST] and listed under "Created" in the report.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import rv  # noqa: E402

TAG = "[CLAIMS-TEST]"
DOCS_PDF = os.path.join(HERE, "..", "..", "Rentvine API Docs.pdf")
TODAY = datetime.date.today().isoformat()

CLAIMS = []
CREATED = []


def claim(cid, area, text, source, kind):
    def deco(fn):
        CLAIMS.append(dict(id=cid, area=area, claim=text, source=source, kind=kind, fn=fn))
        return fn
    return deco


def static(cid, area, text, source, kind, status, evidence):
    CLAIMS.append(dict(id=cid, area=area, claim=text, source=source, kind=kind,
                       fn=lambda ctx: (status, evidence)))


def unwrap(body, key):
    return body.get(key, body) if isinstance(body, dict) else {}


def rows(body):
    if isinstance(body, list):
        return body
    if isinstance(body, dict) and isinstance(body.get("data"), list):
        return body["data"]
    return []


def has_key(obj, key):
    return f'"{key}"' in json.dumps(obj)


def created(kind, ident, note=""):
    CREATED.append(f"{kind} {ident} {note}".strip())


class Ctx:
    def __init__(self, args):
        self.args = args
        self.wo = None          # test work order id
        self.docs = None        # docs PDF text

    def docs_text(self):
        if self.docs is None:
            self.docs = subprocess.run(["pdftotext", DOCS_PDF, "-"], capture_output=True, text=True).stdout
        return self.docs


# ----------------------------------------------------------------------------------------------
# READ claims: safe against any account
# ----------------------------------------------------------------------------------------------

@claim("R01", "Data", "GET /properties returns Google-validated latitude/longitude for every property "
       "(so P16/P07 can drop their own geocoding)", "P20 README 2026-09-11", "read")
def _(ctx):
    s, b = rv.get("properties")
    props = [unwrap(r, "property") for r in rows(b)]
    if s != 200 or not props:
        return "ERROR", f"HTTP {s}"
    with_ll = [p for p in props if p.get("latitude") and p.get("longitude")]
    invalid = [p.get("name") for p in props if (p.get("addressValidationData") or {}).get("isValid") is False]
    ev = f"{len(with_ll)}/{len(props)} have lat/long."
    if invalid:
        ev += (f" But {len(invalid)} are flagged addressValidationData.isValid=false ({', '.join(invalid[:5])}), "
               "so the coordinates exist but Google didn't fully validate the address. Routing should check isValid.")
        return "PARTIAL", ev
    return ("VERIFIED" if len(with_ll) == len(props) else "PARTIAL"), ev


@claim("R02", "Docs accuracy", "docs.rentvine.com paths are wrong in places: /owners (not /contacts/owners), "
       "/maintenance-technicians (not /maintenance/technicians)", "P20 README 2026-09-11", "read")
def _(ctx):
    got = {p: rv.get(p)[0] for p in ["owners", "contacts/owners", "maintenance-technicians", "maintenance/technicians"]}
    ok = got["owners"] == 200 and got["maintenance-technicians"] == 200 and got["contacts/owners"] == 404 \
        and got["maintenance/technicians"] == 404
    return ("VERIFIED" if ok else "REFUTED"), ", ".join(f"/{k} -> {v}" for k, v in got.items())


@claim("R03", "Collections", "GET /leases/export returns pre-aggregated per-lease balances (unpaid/past-due) "
       "so the Collector (P11) doesn't need AppFolio-style report exports", "memory 2026-09-11", "read")
def _(ctx):
    s, b = rv.get("leases/export")
    keys = ["unpaidTotalAmount", "unpaidRentAmount", "pastDueTotalAmount", "pastDueRentAmount", "unpaidCharges"]
    present = [k for k in keys if has_key(b, k)]
    if s != 200:
        return "ERROR", f"HTTP {s}"
    return ("VERIFIED" if len(present) == len(keys) else "PARTIAL"), \
        f"{len(rows(b))} leases; balance fields present: {present}"


@claim("R04", "Maintenance", "Work orders expose scheduling fields (scheduledStartDate, appointment window, "
       "assignedToUserID, priorityID, vendorTradeID) for the Dispatcher", "P20 README", "read")
def _(ctx):
    s, b = rv.get("maintenance/work-orders")
    r = rows(b)
    if s != 200 or not r:
        return "ERROR", f"HTTP {s}"
    wo = unwrap(r[0], "workOrder")
    need = ["scheduledStartDate", "scheduledEndDate", "appointmentWindowStartDateTime",
            "appointmentWindowEndDateTime", "assignedToUserID", "priorityID", "vendorTradeID"]
    missing = [k for k in need if k not in wo]
    return ("VERIFIED" if not missing else "REFUTED"), \
        f"{len(r)} work orders; missing fields: {missing or 'none'}. Also present: diagnosticSummary/agentSummary " \
        f"(Fixie output) = {'diagnosticSummary' in wo}"


@claim("R05", "Reporting", "GET /reports?reportTypeID=N returns report schema only, not data rows "
       "(use /export and /search endpoints instead)", "P20 README", "read")
def _(ctx):
    s, b = rv.get("reports?reportTypeID=1")
    if s != 200:
        return "ERROR", f"HTTP {s}"
    top = list(b.keys()) if isinstance(b, dict) else f"list[{len(b)}]"
    return "PARTIAL", f"HTTP 200, top-level: {top}. No row data seen; no execute endpoint in docs " \
                      f"(see D05). Treat reports as not API-runnable."


@claim("R06", "Leasing", "GET /screening/prospects is pollable with dateTimeModifiedMin", "memory 2026-09-17", "read")
def _(ctx):
    s1, b1 = rv.get("screening/prospects?dateTimeModifiedMin=2099-01-01%2000:00:00")
    s2, b2 = rv.get("screening/prospects?dateTimeModifiedMin=2000-01-01%2000:00:00")
    ok = s1 == 200 and s2 == 200 and len(rows(b1)) == 0 and len(rows(b2)) > 0
    return ("VERIFIED" if ok else "REFUTED"), f"future filter -> {len(rows(b1))} rows, past filter -> {len(rows(b2))} rows"


@claim("R07", "Controls", "GET /accounting/settings exposes isBillApprovalEnabled, isPayoutApprovedByDefault, "
       "isMFACodeRequiredForPayoutApproval", "session 2026-09-17", "read")
def _(ctx):
    s, b = rv.get("accounting/settings")
    st = unwrap(b, "settings")
    keys = ["isBillApprovalEnabled", "isPayoutApprovedByDefault", "isMFACodeRequiredForPayoutApproval"]
    vals = {k: st.get(k) for k in keys}
    return ("VERIFIED" if s == 200 and all(v is not None for v in vals.values()) else "REFUTED"), \
        f"HTTP {s}; current values {vals}"


@claim("R08", "Accounting", "GET /accounting/ledgers/search?search=X is substring match, not exact "
       "(resolvers must filter for exact name)", "P20 README quirk #8", "read")
def _(ctx):
    s, b = rv.get("accounting/ledgers/search?search=Hello1")
    names = [unwrap(r, "ledger").get("name", "") for r in rows(b)]
    loose = [n for n in names if not n.startswith("Hello1 ")]
    if s != 200 or not names:
        return "ERROR", f"HTTP {s}, {len(names)} results (sandbox-specific data; skip on other accounts)"
    return ("VERIFIED" if loose else "REFUTED"), f"search=Hello1 returned {len(names)}: {names[:5]}"


@claim("R09", "Inventory", "Rentvine has a materials catalog (Price Book) but no quantity-on-hand, so van "
       "stock stays in P17", "session 2026-09-17", "read")
def _(ctx):
    s, b = rv.get("maintenance/materials")
    mats = [unwrap(r, "material") for r in rows(b)]
    if s != 200:
        return "ERROR", f"HTTP {s}"
    qty = [k for m in mats[:1] for k in m if re.search(r"qty|quantit|onhand|stock", k, re.I)]
    fields = list(mats[0].keys()) if mats else "catalog empty"
    return ("VERIFIED" if not qty else "REFUTED"), f"{len(mats)} materials; fields: {fields}; quantity-like: {qty or 'none'}"


@claim("R10", "Inventory", "No work-order line items and no inventory endpoints exist", "session 2026-09-17", "read")
def _(ctx):
    s, b = rv.get("maintenance/work-orders")
    wid = unwrap(rows(b)[0], "workOrder")["workOrderID"] if rows(b) else "1"
    got = {p: rv.get(p)[0] for p in [f"maintenance/work-orders/{wid}/line-items", "inventory", "maintenance/inventory"]}
    ok = all(v == 404 for v in got.values())
    return ("VERIFIED" if ok else "REFUTED"), ", ".join(f"/{k} -> {v}" for k, v in got.items()) + \
        ". Note: vendor invoices DO carry lineItems (see W16), so parts can reach Rentvine through invoices/bills."


@claim("R11", "Comms", "Rentvine has comms APIs: WO/lease chat threads and email conversations are readable",
       "API docs PDF, session 2026-09-18", "read")
def _(ctx):
    got = {p: rv.get(p)[0] for p in ["chat/messages?chatObjectTypeID=1&objectID=1",
                                     "contacts/conversations?objectTypeID=7&objectID=1"]}
    return ("VERIFIED" if all(v == 200 for v in got.values()) else "REFUTED"), \
        ", ".join(f"/{k} -> {v}" for k, v in got.items())


@claim("R12", "Leases", "Lease renewals are readable via API (Renewal Engine input)", "session 2026-09-18", "read")
def _(ctx):
    s, b = rv.get("leases/renewals")
    r = rows(b)
    ex = unwrap(r[0], "renewal") if r else {}
    return ("VERIFIED" if s == 200 else "REFUTED"), f"HTTP {s}, {len(r)} renewals; fields: {list(ex.keys())[:14]}"


@claim("R13", "Webhooks", "Webhooks can't be managed via API (UI-only setup)", "session 2026-09-17", "read")
def _(ctx):
    got = {p: rv.get(p)[0] for p in ["webhooks", "settings/webhooks"]}
    in_docs = len(re.findall(r"webhook", ctx.docs_text(), re.I))
    ok = all(v == 404 for v in got.values())
    return ("VERIFIED" if ok else "REFUTED"), \
        ", ".join(f"/{k} -> {v}" for k, v in got.items()) + f"; 'webhook' appears {in_docs}x in the API docs PDF"


# ----------------------------------------------------------------------------------------------
# DOCS claims: what the official API reference does / doesn't offer
# ----------------------------------------------------------------------------------------------

def doc_endpoints(ctx, method_re, path_re):
    t = [l.strip() for l in ctx.docs_text().split("\n") if l.strip()]
    found = set()
    for i, l in enumerate(t[1:], 1):
        if re.fullmatch(method_re, t[i - 1]) and l.startswith("/") and re.search(path_re, l):
            found.add(f"{t[i-1]} {l}")
    return sorted(found)


@claim("D01", "Payables", "No API endpoint can release a payment or run a disbursement; payout is UI-only",
       "P20 README quirk #2", "docs")
def _(ctx):
    hits = doc_endpoints(ctx, r"POST|PUT", r"payout|disburs|pay-bills|bill-pay|/pay$|payments/batch")
    return ("VERIFIED" if not hits else "REFUTED"), f"write endpoints matching payout/disburse: {hits or 'none'}"


@claim("D02", "Onboarding", "No API endpoint creates or links bank accounts", "P20 README", "docs")
def _(ctx):
    hits = doc_endpoints(ctx, r"POST|PUT", r"bank-account")
    return ("VERIFIED" if not hits else "REFUTED"), f"write endpoints on bank-accounts: {hits or 'none'}"


@claim("D03", "Comms", "The API can send SMS, post portal chat, and send email", "API docs PDF", "docs")
def _(ctx):
    need = ["POST /messages/texts/send", "POST /chat/messages", "POST /contacts/conversations"]
    have = doc_endpoints(ctx, r"POST", r"messages|conversations")
    missing = [n for n in need if n not in have]
    return ("VERIFIED" if not missing else "REFUTED"), f"documented: {have}"


@claim("D04", "Money", "The API documents tenant ledger charges/payments, lease recurring charges, bill approve, "
       "deposit reconcile, invoice upload", "API docs PDF", "docs")
def _(ctx):
    need = ["POST /accounting/leases/{leaseID}/charges", "POST /accounting/leases/{leaseID}/payments",
            "POST /leases/{leaseID}/recurring-charges", "POST /accounting/bills/{billID}/approve",
            "POST /accounting/deposits/{depositID}/reconcile", "POST /accounting/invoices/upload"]
    have = set(doc_endpoints(ctx, r"POST", r"."))
    missing = [n for n in need if n not in have]
    return ("VERIFIED" if not missing else "PARTIAL"), f"missing from docs: {missing or 'none'}"


@claim("D05", "Reporting", "There is no documented endpoint to execute a named report", "P20 README", "docs")
def _(ctx):
    hits = doc_endpoints(ctx, r"GET|POST", r"^/reports")
    return ("VERIFIED" if all("{" not in h or "run" not in h for h in hits) else "REFUTED"), f"report endpoints: {hits or 'none'}"


# ----------------------------------------------------------------------------------------------
# WRITE claims: sandbox only
# ----------------------------------------------------------------------------------------------

def wo_get(wid):
    return unwrap(rv.get(f"maintenance/work-orders/{wid}")[1], "workOrder")


@claim("W01", "Maintenance", "Work orders can be created via API", "API docs PDF", "write")
def _(ctx):
    s, b = rv.get("properties/units")
    unit = unwrap(rows(b)[0], "unit")
    s, b = rv.post("maintenance/work-orders", {
        "propertyID": unit["propertyID"], "unitID": unit["unitID"], "isInternal": "1",
        "description": f"{TAG} dispatcher write-back test", "priorityID": "3", "workOrderStatusID": "1"})
    wo = unwrap(b, "workOrder")
    if s == 200 and wo.get("workOrderID"):
        ctx.wo = wo["workOrderID"]
        created("work order", ctx.wo)
        return "VERIFIED", f"workOrderID {ctx.wo} on unit {unit['unitID']}"
    return "REFUTED", f"HTTP {s}: {str(b)[:300]}"


@claim("W02", "Maintenance", "Scheduling written back to a WO persists (date, arrival window). "
       "Only POST works; PUT and PATCH 404", "session 2026-09-17", "write")
def _(ctx):
    if not ctx.wo:
        return "BLOCKED", "needs W01"
    codes = {m: rv.call(m, f"maintenance/work-orders/{ctx.wo}", {"priorityID": "3"})[0] for m in ("PUT", "PATCH")}
    sched = {"scheduledStartDate": "2026-09-29", "scheduledEndDate": "2026-09-29",
             "appointmentWindowStartDateTime": "2026-09-29 09:00:00",
             "appointmentWindowEndDateTime": "2026-09-29 11:00:00"}
    s, _ = rv.post(f"maintenance/work-orders/{ctx.wo}", sched)
    wo = wo_get(ctx.wo)
    wrong = {k: wo.get(k) for k, v in sched.items() if wo.get(k) != v}
    ok = s == 200 and not wrong and all(c == 404 for c in codes.values())
    return ("VERIFIED" if ok else "REFUTED"), f"PUT/PATCH -> {codes}; POST -> {s}; mismatches after re-fetch: {wrong or 'none'}"


@claim("W03", "Maintenance", "A partial WO update doesn't blank fields it didn't send", "open question 2026-09-17", "write")
def _(ctx):
    if not ctx.wo:
        return "BLOCKED", "needs W01"
    before = wo_get(ctx.wo)
    rv.post(f"maintenance/work-orders/{ctx.wo}", {"priorityID": "2"})
    after = wo_get(ctx.wo)
    watch = ["description", "scheduledStartDate", "appointmentWindowStartDateTime", "unitID", "assignedToUserID"]
    lost = {k: (before.get(k), after.get(k)) for k in watch if before.get(k) != after.get(k)}
    ok = after.get("priorityID") == "2" and not lost
    return ("VERIFIED" if ok else "REFUTED"), f"priority now {after.get('priorityID')}; changed unintentionally: {lost or 'none'}"


@claim("W04", "Maintenance", "Tech assignment and priority can be rewritten on a WO", "session 2026-09-17", "write")
def _(ctx):
    if not ctx.wo:
        return "BLOCKED", "needs W01"
    s, b = rv.get("users")
    uid = unwrap(rows(b)[-1], "user").get("userID")
    rv.post(f"maintenance/work-orders/{ctx.wo}", {"assignedToUserID": uid, "priorityID": "1"})
    wo = wo_get(ctx.wo)
    ok = wo.get("assignedToUserID") == uid and wo.get("priorityID") == "1"
    return ("VERIFIED" if ok else "REFUTED"), f"assignedToUserID -> {wo.get('assignedToUserID')} (wanted {uid}), priority -> {wo.get('priorityID')}"


@claim("W05", "Comms", "Agents can post on a work order's chat thread", "API docs PDF", "write")
def _(ctx):
    if not ctx.wo:
        return "BLOCKED", "needs W01"
    s, b = rv.post("chat/messages", {"chatObjectTypeID": 1, "objectID": int(ctx.wo),
                                     "message": f"<p>{TAG} Dispatcher: tech scheduled Tue 9-11am</p>",
                                     "isSharedWithTenant": "0"})
    s2, b2 = rv.get(f"chat/messages?chatObjectTypeID=1&objectID={ctx.wo}")
    seen = TAG in json.dumps(b2)
    return ("VERIFIED" if s == 200 and seen else "REFUTED"), f"POST -> {s}; message visible on WO thread: {seen}"


def ledger_and_payee():
    s, b = rv.get("accounting/ledgers/search?search=Hello1")
    led = next((unwrap(r, "ledger") for r in rows(b) if unwrap(r, "ledger").get("name", "").startswith("Hello1 ")), None)
    s, v = rv.get("vendors")
    payee = next((unwrap(r, "contact")["contactID"] for r in rows(v)
                  if "Green Property" in (unwrap(r, "contact").get("name") or "")), None)
    return (led or {}).get("ledgerID"), payee


def bill(payee, ledger, ref, amount="4.99", **extra):
    return rv.post("accounting/bills", dict({
        "payeeContactID": payee, "billDate": TODAY, "dateDue": TODAY, "reference": ref,
        "charges": [{"ledgerID": ledger, "chargeAccountID": 30, "amount": amount, "description": TAG}]}, **extra))


@claim("W06", "Payables", "Bill create field names are payeeContactID / billDate / dateDue / charges[].chargeAccountID "
       "(the obvious names like vendorContactID/dueDate/accountID are rejected)", "session 2026-09-17", "write")
def _(ctx):
    ledger, payee = ledger_and_payee()
    if not (ledger and payee):
        return "BLOCKED", "sandbox-specific ledger/payee lookup failed"
    wrong, _ = rv.post("accounting/bills", {"vendorContactID": payee, "billDate": TODAY, "dueDate": TODAY,
                                           "charges": [{"ledgerID": ledger, "accountID": 30, "amount": "1"}]})
    s, b = bill(payee, ledger, f"{TAG}-W06")
    bid = unwrap(b, "bill").get("billID")
    if bid:
        created("bill", bid)
    return ("VERIFIED" if wrong == 400 and s == 200 else "REFUTED"), f"obvious names -> {wrong}; correct names -> {s} (billID {bid})"


@claim("W07", "Inventory", "A bill can carry workOrderID, so parts/labor trace to the job", "session 2026-09-17", "write")
def _(ctx):
    ledger, payee = ledger_and_payee()
    if not (ledger and payee and ctx.wo):
        return "BLOCKED", "needs W01 + ledger/payee"
    s, b = bill(payee, ledger, f"{TAG}-W07", workOrderID=int(ctx.wo))
    bid = unwrap(b, "bill").get("billID")
    created("bill", bid, f"(linked to WO {ctx.wo})")
    got = unwrap(rv.get(f"accounting/bills/{bid}")[1], "bill").get("workOrderID")
    return ("VERIFIED" if str(got) == str(ctx.wo) else "REFUTED"), f"billID {bid}, workOrderID on re-fetch = {got}"


@claim("W08", "Payables", "No write dedup: posting the identical bill twice creates two bills", "P20 README quirk #1", "write")
def _(ctx):
    ledger, payee = ledger_and_payee()
    ids = [unwrap(bill(payee, ledger, f"{TAG}-W08-dup")[1], "bill").get("billID") for _ in range(2)]
    for i in ids:
        created("bill", i, "(dedup test)")
    return ("VERIFIED" if ids[0] and ids[1] and ids[0] != ids[1] else "REFUTED"), f"billIDs {ids}"


@claim("W09", "Controls", "Turning on isBillApprovalEnabled makes new bills land unapproved, and "
       "POST /accounting/bills/{id}/approve approves them via API", "session 2026-09-17", "write")
def _(ctx):
    ledger, payee = ledger_and_payee()
    orig = unwrap(rv.get("accounting/settings")[1], "settings").get("isBillApprovalEnabled")
    try:
        rv.post("accounting/settings", {"isBillApprovalEnabled": 1})
        b = unwrap(bill(payee, ledger, f"{TAG}-W09-gate")[1], "bill")
        created("bill", b.get("billID"), "(approval gate test)")
        s, a = rv.post(f"accounting/bills/{b.get('billID')}/approve")
        after = unwrap(rv.get(f"accounting/bills/{b.get('billID')}")[1], "bill").get("isApproved")
        ok = b.get("isApproved") == "0" and str(after) == "1"
        return ("VERIFIED" if ok else "PARTIAL"), \
            f"with gate on: isApproved={b.get('isApproved')}; /approve -> HTTP {s}; after approve isApproved={after}"
    finally:
        rv.post("accounting/settings", {"isBillApprovalEnabled": int(orig or 0)})


@claim("W10", "Payables", "Bills can't be voided via API (docs claim DELETE voids them)", "P20 README quirk #4 vs API docs", "write")
def _(ctx):
    ledger, payee = ledger_and_payee()
    bid = unwrap(bill(payee, ledger, f"{TAG}-W10-void")[1], "bill").get("billID")
    created("bill", bid, "(void test)")
    tries = {}
    for m, p in [("DELETE", f"accounting/bills/{bid}"), ("DELETE", f"bills/{bid}"),
                 ("POST", f"accounting/bills/{bid}/void")]:
        tries[f"{m} /{p}"] = rv.call(m, p)[0]
        if unwrap(rv.get(f"accounting/bills/{bid}")[1], "bill").get("isVoided") == "1":
            return "REFUTED", f"voiding WORKS via {m} /{p} (HTTP {tries[f'{m} /{p}']}); tries: {tries}"
    return "VERIFIED", f"no void path worked, isVoided still 0; tries: {tries}"


@claim("W11", "Onboarding", "POST /properties is blocked for manager API keys ('Portfolio not found' for any portfolio)",
       "P20 README 2026-09-11", "write")
def _(ctx):
    s, b = rv.get("portfolios")
    pid = unwrap(rows(b)[0], "portfolio").get("portfolioID")
    s, b = rv.post("properties", {"portfolioID": pid, "name": f"{TAG} property", "address": "1 Test St",
                                  "city": "Grand Rapids", "stateID": "MI", "postalCode": "49503",
                                  "propertyTypeID": 1, "isMultiUnit": 0, "marketRentAmount": "1000",
                                  "reserveAmount": "0"})
    if s == 200:
        created("property", unwrap(b, "property").get("propertyID"))
        return "REFUTED", "property creation WORKS now"
    return ("VERIFIED" if "Portfolio not found" in json.dumps(b) else "PARTIAL"), f"HTTP {s}: {str(b)[:200]}"


@claim("W12", "Onboarding", "POST /owners creates an owner, including its email",
       "P20 README", "write")
def _(ctx):
    s, b = rv.post("owners", {"name": "ClaimsTest Owner", "firstName": "ClaimsTest", "lastName": "Owner",
                              "email": "claims.test@example.com"})
    o = unwrap(b, "contact")
    oid = o.get("contactID")
    if s != 200:
        return "REFUTED", f"HTTP {s}: {b}"
    created("owner", oid)
    rv.post(f"owners/{oid}", {"email": "claims.test@example.com"})  # try again as an update
    got = unwrap(rv.get(f"owners/{oid}")[1], "contact")
    if got.get("email"):
        return "VERIFIED", f"owner {oid}, email saved"
    return "PARTIAL", f"owner {oid} created (name required; first/last saved as sent). Email NOT saved on create or " \
                      f"on a follow-up update (both HTTP 200, silent no-op). Intake automation can't set owner email; " \
                      f"a human adds it, or ask Rentvine for the right field."


@claim("W13", "Leasing", "Prospects link to a unit via unitID (propertyID auto-fills); phone must be E.164; "
       "status updates are silently ignored", "Rentvine developer email 2026-09-18 + session", "write")
def _(ctx):
    s, b = rv.get("properties/units")
    unit = unwrap(rows(b)[0], "unit")
    bad, _ = rv.post("screening/prospects", {"name": f"{TAG} dashed", "phone": "616-555-0142"})
    s, b = rv.post("screening/prospects", {"name": f"{TAG} prospect", "phone": "+16165550142",
                                           "email": f"claims.lead.{int(time.time())}@example.com",
                                           "unitID": unit["unitID"]})
    p = unwrap(b, "prospect")
    created("prospect", p.get("prospectID"))
    st, _ = rv.post(f"screening/prospects/{p.get('prospectID')}", {"status": "contacted"})
    after = unwrap(rv.get(f"screening/prospects/{p.get('prospectID')}")[1], "prospect")
    parts = [f"dashed phone -> {bad}", f"unitID {unit['unitID']} -> propertyID {after.get('propertyID')}",
             f"status update HTTP {st}, status now {after.get('status')!r}"]
    ok = bad == 400 and after.get("propertyID") == unit["propertyID"]
    return ("VERIFIED" if ok else "PARTIAL"), "; ".join(parts)


@claim("W22", "Leasing", "Prospect creation silently dedups on email + unit: a repeat returns HTTP 200 with "
       "prospectID null; the same email on a different unit creates a new prospect", "session 2026-09-18", "write")
def _(ctx):
    s, b = rv.get("properties/units")
    u1, u2 = [unwrap(r, "unit")["unitID"] for r in rows(b)[:2]]
    email = f"claims.dedup.{int(time.time())}@example.com"
    ids = []
    for unit in (u1, u1, u2):
        s, b = rv.post("screening/prospects", {"name": f"{TAG} dedup", "email": email, "unitID": unit})
        ids.append((s, unwrap(b, "prospect").get("prospectID")))
    for _, i in ids:
        if i:
            created("prospect", i, "(dedup test)")
    ok = ids[0][1] and ids[1] == (200, None) and ids[2][1]
    return ("VERIFIED" if ok else "REFUTED"), f"unit {u1} -> {ids[0]}, unit {u1} again -> {ids[1]}, unit {u2} -> {ids[2]}"


@claim("W14", "Comms", "The API can text a real phone (POST /messages/texts/send)", "session 2026-09-18", "write")
def _(ctx):
    if not ctx.args.sms_to:
        return "HUMAN", "skipped: pass --sms-to +1XXXXXXXXXX. Verified once 2026-09-18: textMessageIDs 10 and 11 " \
                        "reached Matt's phone from +12398427953."
    s, b = rv.post("messages/texts/send", {"to": ctx.args.sms_to, "message": f"{TAG} Rentvine SMS check {TODAY}"})
    m = unwrap(b, "textMessage")
    quoted = str(m.get("message", "")).startswith('"')
    return ("VERIFIED" if s == 200 else "REFUTED"), \
        f"HTTP {s}, textMessageID {m.get('textMessageID')} from {m.get('from')}. Stored body wrapped in literal " \
        f"quotes: {quoted}. Check the phone to see whether the quotes show up."


@claim("W15", "Comms", "The API can email a prospect/tenant, logged on the unit", "API docs PDF", "write")
def _(ctx):
    s, b = rv.post("contacts/conversations", {"recipients": ["claims.test@example.com"], "subject": TAG,
                                              "message": f"<p>{TAG}</p>", "objectTypeID": 7, "objectID": 26,
                                              "templateObjectTypeID": 7})
    if s == 200:
        return "VERIFIED", "email sent"
    if "fromEmailConversationRecipient" in json.dumps(b):
        return "BLOCKED", "the API key's user has no sender identity ('Failed to find email conversation " \
                          "recipient'). Also needs templateObjectTypeID even though the docs call it optional. " \
                          "The UI gives keys no user or email: New API Key has only Name + Role, and Edit Key " \
                          "offers only Update Secret / Edit Pods / Delete (screenshots 2026-09-18). Asked Rentvine " \
                          "2026-09-18. Until then, send email from GPM's own Gmail instead."
    return "REFUTED", f"HTTP {s}: {str(b)[:250]}"


@claim("W16", "Payables", "Uploading a vendor invoice PDF triggers Rentvine's AI extraction (vendor, amount, GL, WO)",
       "rentvine.com/ai-assistant + API docs", "write")
def _(ctx):
    if not ctx.wo:
        return "BLOCKED", "needs W01"
    wo = wo_get(ctx.wo)
    prop = unwrap(rv.get(f"properties/{wo['propertyID']}")[1], "property")
    pdf = make_invoice_pdf(prop.get("address", ""), wo.get("workOrderNumber", ""))
    s, b = rv.upload("accounting/invoices/upload", "claims-test-invoice.pdf", pdf)
    inv = unwrap(b, "invoice")
    iid = inv.get("invoiceID")
    if s != 200 or not iid:
        return "REFUTED", f"upload HTTP {s}: {str(b)[:250]}"
    created("invoice", iid)
    for _ in range(12):
        time.sleep(10)
        inv = unwrap(rv.get(f"accounting/invoices/{iid}")[1], "invoice")
        if inv.get("invoiceStatusID") != "1":
            break
    pick = ["predictedPayeeContactName", "predictedAmount", "predictedReference", "predictedWorkOrderID",
            "predictedLedgerAddress", "predictedAccountID"]
    pred = {k: inv.get(k) for k in pick}
    if any(v for v in pred.values()):
        led = unwrap(rv.get(f"accounting/ledgers/{inv.get('predictedLedgerID')}")[1], "ledger")
        # A ledger can belong to the property or to the unit (ledgerTypeID differs); either is correct coding.
        right_prop = str(led.get("objectID")) in (str(wo["propertyID"]), str(wo.get("unitID")))
        right_wo = str(inv.get("predictedWorkOrderID")) == str(ctx.wo)
        gaps = [g for g, bad in [("wrong property", not right_prop), ("wrong WO", not right_wo),
                                 ("no GL account", not inv.get("predictedAccountID"))] if bad]
        return ("VERIFIED" if not gaps else "PARTIAL"), \
            f"invoiceID {iid}: {pred}. Gaps: {gaps or 'none'}. 2026-09-18 run with a deliberately conflicting " \
            f"address: AI coded to the WO's property and did NOT flag the mismatch, so an AP agent must " \
            f"cross-check address vs WO property before approving."
    return "PARTIAL", f"invoiceID {iid} uploaded but no predicted fields after ~2 min (status " \
                      f"{inv.get('invoiceStatusID')}). Extraction may be async-slow or disabled in the sandbox; re-run later."


def make_invoice_pdf(address, wo_number):
    lines = ["ROYAL PEST CONTROL", "Invoice #CT-1001   Date: " + TODAY, "Bill To: Green Property Management",
             f"Service address: {address}", f"Work Order: {wo_number}",
             "Quarterly pest treatment ........ $85.00", "TOTAL DUE: $85.00   Terms: Net 30"]
    text = "BT /F1 12 Tf 60 740 Td 16 TL " + " ".join(f"({l}) Tj T*" for l in lines) + " ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
            "/Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(text)} >>\nstream\n{text}\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
    out += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


@claim("W17", "Collections", "Charges can be posted to a tenant's lease ledger (damage chargebacks, fees)",
       "API docs PDF", "write")
def _(ctx):
    s, b = rv.get("leases")
    lease = next((unwrap(r, "lease") for r in rows(b)), None)
    if not lease:
        return "BLOCKED", "no lease in account"
    s, b = rv.post(f"accounting/leases/{lease['leaseID']}/charges",
                   {"datePosted": TODAY, "amount": "1.00", "chargeAccountID": "18", "description": f"{TAG} chargeback"})
    t = unwrap(b, "transaction")
    if s == 200:
        created("lease charge", t.get("transactionID"), f"(lease {lease['leaseID']}, $1.00)")
    return ("VERIFIED" if s == 200 else "REFUTED"), f"lease {lease['leaseID']}: HTTP {s} {str(b)[:200] if s != 200 else 'transactionID ' + str(t.get('transactionID'))}"


@claim("W18", "Leases", "Recurring lease charges (e.g. new rent at renewal) can be created and removed via API",
       "API docs PDF", "write")
def _(ctx):
    s, b = rv.get("leases")
    lease = next((unwrap(r, "lease") for r in rows(b)), None)
    s, b = rv.post(f"leases/{lease['leaseID']}/recurring-charges", {
        "dayDue": 1, "frequency": 1, "accountID": "16", "amount": "1.00", "description": f"{TAG} recurring",
        "startDate": "01/01/2030", "endDate": "02/01/2030"})
    if s != 200:
        return "REFUTED", f"create HTTP {s}: {str(b)[:250]}"
    cid = next((v for k, v in (unwrap(b, "recurringCharge") or {}).items() if k.lower().endswith("chargeid")), None) \
        or re.search(r'"(?:recurringChargeID|chargeID|leaseRecurringChargeID)"\s*:\s*"?(\d+)', json.dumps(b))
    cid = cid.group(1) if hasattr(cid, "group") else cid
    d = rv.call("DELETE", f"leases/{lease['leaseID']}/recurring-charges/{cid}")[0] if cid else None
    if d != 200:
        created("recurring charge", cid, f"(lease {lease['leaseID']}, not removed)")
    return ("VERIFIED" if d == 200 else "PARTIAL"), f"create 200 (id {cid}); delete -> {d}"


@claim("W19", "Inventory", "Materials (Price Book items) can be created via API, with unique names enforced",
       "API docs PDF", "write")
def _(ctx):
    name = f"{TAG} supply line {int(time.time())}"
    s1, b1 = rv.post("maintenance/materials", {"name": name, "sellPrice": "12.00", "purchasePrice": "7.50", "upc": "000000000000"})
    s2, _ = rv.post("maintenance/materials", {"name": name, "sellPrice": "12.00"})
    created("material", unwrap(b1, "material").get("materialID"))
    return ("VERIFIED" if s1 == 200 and s2 == 400 else "PARTIAL"), f"create -> {s1}; duplicate name -> {s2}"


@claim("W20", "Architecture", "Agents can stamp their status onto Rentvine records via custom field values",
       "API docs PDF, session idea 2026-09-18", "write")
def _(ctx):
    s, b = rv.get("custom-fields")
    fields = [unwrap(r, "customField") for r in rows(b)]
    if not fields:
        return "BLOCKED", "no custom fields defined in account (create one in Settings first)"
    f = fields[0]
    tries = {}
    for otid, oid in [(6, 10), (7, 26), (4, 1)]:
        s3, b3 = rv.post(f"custom-fields/values/{otid}/{oid}",
                         {f["customFieldID"]: "claims-test", "customFieldCategoryID": f["customFieldCategoryID"]})
        tries[f"{otid}/{oid}"] = s3
        if s3 == 200:
            return "VERIFIED", f"wrote field {f['name']!r} on objectType {otid} id {oid}"
    return "PARTIAL", f"field {f['name']!r} (category object type {f.get('customFieldCategoryObjectTypeID')}) " \
                      f"rejected on {tries}; endpoint exists, needs the right object type mapping"


def webhook_deliveries(tok):
    req = urllib.request.Request(f"https://webhook.site/token/{tok}/requests?sorting=newest&per_page=50",
                                 headers={"Accept": "application/json"})
    out = []
    for r in json.loads(urllib.request.urlopen(req, timeout=30).read()).get("data", []):
        try:
            out.append(json.loads(r.get("content") or "{}"))
        except ValueError:
            pass
    return out


@claim("W21", "Webhooks", "Rentvine fires signed webhooks within seconds of a work order being created/updated, "
       "with a field-level change diff and the acting userID", "help.rentvine.com/how-to-add-webhooks", "write")
def _(ctx):
    tok = ctx.args.webhook_token
    if not tok:
        return "HUMAN", "run --webhook-setup, add the URL in Rentvine Settings > Other > Webhooks (one webhook per " \
                        "event: Work Order Created/Updated, Lease Created/Updated), then re-run with --webhook-token"
    if not ctx.wo:
        return "BLOCKED", "needs W01"
    time.sleep(10)
    hits = [d for d in webhook_deliveries(tok) if str((d.get("data") or {}).get("workOrderID")) == str(ctx.wo)]
    if not hits:
        return "REFUTED", f"no delivery for WO {ctx.wo} within 10s"
    types = sorted({(d.get("event") or {}).get("eventType") for d in hits})
    signed = all((d.get("auth") or {}).get("signature") for d in hits)
    diff = any((d.get("event") or {}).get("changes") for d in hits)
    who = {(d.get("event") or {}).get("userID") for d in hits}
    ok = signed and diff
    return ("VERIFIED" if ok else "PARTIAL"), \
        f"{len(hits)} deliveries for WO {ctx.wo}: {types}. Signature in BODY auth.signature/token/timestamp " \
        f"(not headers): {signed}. Change diff (previous/current per field): {diff}. Acting userID: {who}, so " \
        f"agents can skip their own writes. Note event.options.sendVendorNotification=true on API writes. " \
        f"~1s latency observed 2026-09-18."


@claim("W23", "Leasing", "Recording a tenant's notice (noticeDate/expectedMoveOutDate) on a lease works via API and "
       "fires a Lease Updated webhook with the diff (the trigger for listing + turn automation)",
       "API docs PDF + session 2026-09-18", "write")
def _(ctx):
    s, b = rv.get("leases")
    lease = next((unwrap(r, "lease") for r in rows(b) if unwrap(r, "lease").get("primaryLeaseStatusID") == "2"),
                 unwrap(rows(b)[0], "lease"))
    lid = lease["leaseID"]
    before = unwrap(rv.get(f"leases/{lid}")[1], "lease")
    orig = {k: before.get(k) for k in ("noticeDate", "expectedMoveOutDate")}
    try:
        s, b = rv.post(f"leases/{lid}", {"noticeDate": TODAY, "expectedMoveOutDate": "2026-10-31"})
        after = unwrap(rv.get(f"leases/{lid}")[1], "lease")
        saved = after.get("noticeDate") == TODAY and after.get("expectedMoveOutDate") == "2026-10-31"
        ev = f"lease {lid}: POST -> {s}; saved on re-fetch: {saved}"
        if ctx.args.webhook_token:
            time.sleep(10)
            hits = [d for d in webhook_deliveries(ctx.args.webhook_token)
                    if (d.get("event") or {}).get("eventType", "").startswith("lease")
                    and str((d.get("event") or {}).get("objectID")) == str(lid)
                    and "noticeDate" in json.dumps((d.get("event") or {}).get("changes"))]
            ev += f"; lease webhook with noticeDate diff: {bool(hits)}" + \
                  (f" ({hits[0]['event']['eventType']})" if hits else "")
            return ("VERIFIED" if saved and hits else "PARTIAL"), ev
        return ("VERIFIED" if saved else "REFUTED"), ev + " (webhook not checked: no --webhook-token)"
    finally:
        rv.post(f"leases/{lid}", orig)


# ----------------------------------------------------------------------------------------------
# HUMAN / VENDOR / EXTERNAL claims: can't be settled by an API call
# ----------------------------------------------------------------------------------------------

static("H01", "AI", "Fixie (Rentvine's maintenance AI) takes phone calls", "early research, 2026-09-17", "human",
       "REFUTED", "Sandbox Settings > Maintenance > AI agents (Matt's screenshot 2026-09-18): 'Tenants submit requests "
                  "via chat'. Chat only. Cost: Free, status Active. Phone intake needs an outside voice provider.")
static("H02", "AI", "Rentvine's official MCP is available to connect Claude", "Rentvine Be Herd PR, May 2026", "vendor",
       "VENDOR", "Not in the sandbox: no 'mcp' search results, not under Users, Roles and API (screenshots 2026-09-18). "
                 "The old npm server was deprecated 2026-04-25. Ask the rep: is the MCP live for production accounts, "
                 "read-only or read/write, and which permissions/audit controls apply.")
static("H03", "AI", "Rentvine 'Pro Skills' agents will do autonomous work", "Rentvine Be Herd PR, May 2026", "vendor",
       "VENDOR", "Announced roadmap, no release date, not in the sandbox. Don't count it in the business case.")
static("H04", "AI", "The Rentvine AI Assistant (voice/type to record receipts, bills, charges) is included",
       "rentvine.com/ai-assistant", "vendor",
       "PARTIAL", "An 'Assistant' button is visible in the sandbox top bar (screenshots). Its capabilities are untested. "
                  "Try it: 'add a $40 bill from Royal Pest Control to Hello1'.")
static("H05", "Pricing", "Rentvine costs $2.50/unit/mo, $199 minimum, ~$1.50 negotiated at scale, everything included",
       "rentvine.com/pricing + third-party review", "external",
       "EXTERNAL", "Get a written quote at GPM's door count, including setup fee, payments/screening fees, "
                   "and whether the API, MCP, Fixie and SMS are included at that tier.")
static("H06", "Pricing", "AppFolio gates API access behind Plus/Max, so an API costs GPM ~$70k/yr more on AppFolio",
       "this project's own vision pitch 2026-09-17, from third-party pricing sites", "external",
       "REFUTED", "GPM already pays a per-unit READ-API add-on on part of its portfolio, on top of its base AppFolio rate "
                  "(Matt, 2026-09-18). Exact contract pricing is kept out of this public repo. AppFolio's real gap is WRITE "
                  "access, not API access; pitch the difference as read/write + webhooks, not 'API vs no API'.")
static("H10", "Pricing", "Rentvine texting (POST /messages/texts/send) is free at scale", "open question 2026-09-18",
       "vendor", "VENDOR", "Unknown. Sends come from a Rentvine-owned number (+12398427953). Asked Rentvine in writing "
                           "2026-09-18. Market rate for app-sent SMS is ~$0.01-0.05/message if they bill it.")
static("H07", "Leasing", "/screening/prospects is Rentvine's official lead-capture path", "Rentvine developer email to Matt 2026-09-18",
       "vendor", "VERIFIED", "Confirmed in writing by a Rentvine developer. Behavior tested live in W13.")
static("H08", "Platform", "Sandbox API behavior matches a production account on GPM's plan", "assumed everywhere",
       "human", "HUMAN", "Unverified, and every W-claim depends on it. Ask the rep: are API permissions, rate limits and "
                         "blocked writes (e.g. POST /properties) the same on production? After migration, re-run this "
                         "script read-only against the real account.")
static("H09", "Payables", "Owner-direct bill pay across many owner bank accounts works on Rentvine", "Matt, 2026-09-18",
       "human", "HUMAN", "Matt notes this isn't Rentvine's intended design and GPM plans to move away from it eventually. "
                         "Confirm with the rep and the migration vendor how many bank accounts/trust setups carry over.")


# ----------------------------------------------------------------------------------------------

def webhook_setup():
    req = urllib.request.Request("https://webhook.site/token", method="POST", data=b"{}",
                                 headers={"Content-Type": "application/json", "Accept": "application/json"})
    tok = json.loads(urllib.request.urlopen(req, timeout=30).read())["uuid"]
    print(f"Paste this URL into Rentvine Settings > Other > Webhooks (Work Orders: create + update):\n"
          f"  https://webhook.site/{tok}\nThen run:\n  python3 verify/verify_claims.py --writes --webhook-token {tok}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--writes", action="store_true", help="run write tests (sandbox only)")
    ap.add_argument("--allow-prod-writes", action="store_true")
    ap.add_argument("--sms-to")
    ap.add_argument("--webhook-token")
    ap.add_argument("--webhook-setup", action="store_true")
    ap.add_argument("--only", help="comma-separated claim ids")
    a = ap.parse_args()
    if a.webhook_setup:
        return webhook_setup()
    host = rv.BASE.split("//")[-1].split("/")[0]
    if a.writes and not host.startswith("demo") and not a.allow_prod_writes:
        sys.exit(f"refusing write tests against {host}: not a demo sandbox (use --allow-prod-writes deliberately)")
    ctx, results = Ctx(a), []
    only = set(a.only.split(",")) if a.only else None
    for c in CLAIMS:
        if only and c["id"] not in only:
            continue
        if c["kind"] == "write" and not a.writes:
            status, ev = "SKIPPED", "write test; run with --writes against a sandbox"
        else:
            try:
                status, ev = c["fn"](ctx)
            except Exception as e:  # a broken test must never masquerade as a finding
                status, ev = "ERROR", f"{type(e).__name__}: {e}"
        results.append({k: c[k] for k in ("id", "area", "claim", "source", "kind")} | {"status": status, "evidence": ev})
        print(f"{status:9} {c['id']}  {c['claim'][:90]}")
    write_report(host, results, a)


def write_report(host, results, a):
    out = os.path.join(HERE, "results")
    os.makedirs(out, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M")
    base = os.path.join(out, f"claims_{host.split('.')[0]}_{stamp}")
    json.dump({"account": host, "run": stamp, "writes": a.writes, "results": results, "created": CREATED},
              open(base + ".json", "w"), indent=2)
    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    md = [f"# Rentvine claims ledger: {host}", "",
          f"Run {stamp}, writes {'on' if a.writes else 'off'}. " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())), "",
          "| ID | Area | Claim | Source | Status | Evidence |", "|---|---|---|---|---|---|"]
    for r in results:
        esc = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
        md.append(f"| {r['id']} | {r['area']} | {esc(r['claim'])} | {esc(r['source'])} | **{r['status']}** | {esc(r['evidence'])} |")
    if CREATED:
        md += ["", "## Created by this run (tagged " + TAG + ")", ""] + [f"- {c}" for c in CREATED]
    open(base + ".md", "w").write("\n".join(md) + "\n")
    print(f"\nreport: {base}.md")


if __name__ == "__main__":
    main()
