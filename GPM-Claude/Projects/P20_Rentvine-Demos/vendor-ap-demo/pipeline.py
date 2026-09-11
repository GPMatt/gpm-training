"""
Vendor AP demo pipeline — mock invoices in, correctly-coded Rentvine Bills out.

Sandbox: Demo Account 33 "Green Property Management Group", expires 2026-10-01.
See ../README.md for the full quirk list this code works around. Short version:
  - No write dedup -> we keep our own idempotency ledger (ledger.json).
  - Payout is UI-only -> this pipeline never tries to pay anything, only creates
    correctly-coded Bills sitting in the payables queue.
  - Never trust a 200 alone -> every write is re-fetched before we call it confirmed.
  - A created Bill is always auto-approved -> we don't design around a "pending" state.
"""
import json
import os
from datetime import datetime, timezone

import requests

BASE_URL = "https://demopm33.rentvine.com/api/manager"
AUTH = ("e8b39bfd118949448dbfb0e8a63f6924", "50548bff12d54703b7b41fdc34373ef8")
HEADERS = {"Accept": "application/json", "Content-Type": "application/json"}

HERE = os.path.dirname(os.path.abspath(__file__))
INVOICES_PATH = os.path.join(HERE, "invoices.json")
VENDOR_MAP_PATH = os.path.join(HERE, "vendor_map.json")
LEDGER_PATH = os.path.join(HERE, "ledger.json")


def _get(path, params=None):
    r = requests.get(f"{BASE_URL}{path}", auth=AUTH, headers=HEADERS, params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def _post(path, payload):
    r = requests.post(f"{BASE_URL}{path}", auth=AUTH, headers=HEADERS, json=payload, timeout=20)
    r.raise_for_status()
    return r.json()


def _load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def _save_ledger(ledger):
    with open(LEDGER_PATH, "w") as f:
        json.dump(ledger, f, indent=2)


def _find_vendor(name):
    for v in _get("/vendors"):
        contact = v.get("contact", v)
        if contact.get("name") == name:
            return contact["contactID"]
    return None


def resolve_vendor(name):
    contact_id = _find_vendor(name)
    created = False
    if not contact_id:
        resp = _post("/vendors", {"name": name})
        contact_id = resp.get("contact", resp).get("contactID") or _find_vendor(name)
        created = True
    # quirk #3: re-fetch before trusting the write landed
    _get(f"/vendors/{contact_id}")
    return contact_id, created


_property_cache = None


def _properties():
    global _property_cache
    if _property_cache is None:
        props = _get("/properties")
        _property_cache = {p.get("property", p)["name"]: p.get("property", p) for p in props}
    return _property_cache


def resolve_ledger(property_name):
    """Rentvine's ledger search is substring, not exact — search=Hello1 also
    returns Hello10/Hello11/Hello12. Filter to the unit whose name matches
    the property exactly before trusting a result."""
    results = _get("/accounting/ledgers/search", params={"search": property_name})
    exact = [r for r in results if r.get("unit", {}).get("name") == property_name]
    if not exact:
        raise ValueError(
            f"No exact ledger match for property '{property_name}' "
            f"(search returned {len(results)} loose/substring matches)"
        )
    match = exact[0]
    property_id = match["unit"]["propertyID"]
    portfolio_id = _properties().get(property_name, {}).get("portfolioID")
    return match["ledger"]["ledgerID"], property_id, portfolio_id


def process_invoice(invoice, vendor_map, ledger):
    ref = invoice["invoiceRef"]
    prior = ledger.get(ref)

    if prior and prior.get("status") == "created":
        bill = _get(f"/accounting/bills/{prior['billID']}")["bill"]
        return {
            **invoice,
            "status": "skipped-duplicate",
            "billID": prior["billID"],
            "vendorContactID": prior.get("vendorContactID"),
            "portfolioID": prior.get("portfolioID"),
            "resolvedPropertyName": prior.get("resolvedPropertyName"),
            "chargeAccountName": prior.get("chargeAccountName"),
            "note": "Already created by a previous click — skipped re-posting so this doesn't create a duplicate bill (Rentvine itself has no server-side dedup on this).",
            "confirmed": bill.get("isVoided") == "0",
            "warnings": [],
        }

    warnings = []
    vendor_contact_id, vendor_created = resolve_vendor(invoice["vendorName"])

    if invoice["vendorShape"] == "recurring":
        mapping = vendor_map.get(invoice["vendorName"])
        if not mapping:
            raise ValueError(f"No static vendor->property mapping for recurring vendor '{invoice['vendorName']}'")
        property_name = mapping["property"]
        charge_account_id = mapping["chargeAccountID"]
        charge_account_name = mapping["chargeAccountName"]
        if invoice.get("propertyName") and invoice["propertyName"] != property_name:
            warnings.append(
                f"Invoice printed property '{invoice['propertyName']}' but the static map for this "
                f"vendor says '{property_name}' — used the map, since recurring vendors are trusted "
                f"on the mapping, not per-invoice text. Worth a human glance."
            )
    else:
        property_name = invoice["propertyName"]
        charge_account_id = invoice["chargeAccountID"]
        charge_account_name = invoice["chargeAccountName"]

    ledger_id, property_id, portfolio_id = resolve_ledger(property_name)

    payload = {
        "payeeContactID": vendor_contact_id,
        "billDate": invoice["invoiceDate"],
        "dateDue": invoice["dueDate"],
        "reference": ref,
        "description": invoice["description"],
        "charges": [
            {
                "ledgerID": ledger_id,
                "chargeAccountID": charge_account_id,
                "amount": invoice["amount"],
                "description": invoice["description"],
            }
        ],
    }
    created = _post("/accounting/bills", payload)
    bill_id = created.get("bill", created)["billID"]

    # quirk #3: never trust the write, re-fetch the bill AND the payables queue
    bill = _get(f"/accounting/bills/{bill_id}")["bill"]
    payables = _get("/accounting/payables")
    landed = [p["transaction"] for p in payables if p["transaction"].get("billID") == str(bill_id)]
    landed_amount = sum(float(t["amount"]) for t in landed)

    confirmed = (
        bill.get("isVoided") == "0"
        and bill.get("isApproved") == "1"
        and len(landed) > 0
        and abs(landed_amount - float(invoice["amount"])) < 0.01
    )

    ledger[ref] = {
        "status": "created",
        "billID": bill_id,
        "vendorContactID": vendor_contact_id,
        "portfolioID": portfolio_id,
        "resolvedPropertyName": property_name,
        "chargeAccountName": charge_account_name,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    _save_ledger(ledger)

    return {
        **invoice,
        "status": "created",
        "billID": bill_id,
        "vendorContactID": vendor_contact_id,
        "vendorCreated": vendor_created,
        "resolvedPropertyName": property_name,
        "chargeAccountName": charge_account_name,
        "portfolioID": portfolio_id,
        "confirmed": confirmed,
        "warnings": warnings,
    }


def run_demo():
    invoices = _load_json(INVOICES_PATH, [])
    vendor_map = _load_json(VENDOR_MAP_PATH, {})
    ledger = _load_json(LEDGER_PATH, {})

    results = []
    for invoice in invoices:
        try:
            results.append(process_invoice(invoice, vendor_map, ledger))
        except Exception as e:  # noqa: BLE001 - surface any failure straight to the results view
            results.append({**invoice, "status": "error", "error": str(e)})

    portfolio_names = {}
    for p in _get("/portfolios"):
        portfolio = p.get("portfolio", p)
        portfolio_names[portfolio["portfolioID"]] = portfolio.get("name")

    batches = {}
    for r in results:
        if r["status"] in ("created", "skipped-duplicate") and r.get("portfolioID"):
            pid = r["portfolioID"]
            batch = batches.setdefault(
                pid,
                {"portfolioID": pid, "portfolioName": portfolio_names.get(pid, f"Portfolio {pid}"), "bills": [], "total": 0.0},
            )
            batch["bills"].append(r)
            batch["total"] += float(r["amount"])

    return {"results": results, "batches": list(batches.values())}


def preview_invoices():
    return _load_json(INVOICES_PATH, [])


def current_ledger():
    return _load_json(LEDGER_PATH, {})


def reset_ledger():
    """Clears our local dedup ledger only — for rehearsal, before the real live
    run. This does NOT touch Rentvine: the bills already created during a
    rehearsal stay in the sandbox (harmless leftovers, quirk #4 means they
    can't be voided/deleted via API anyway). The next click after a reset will
    create brand-new bills reusing the same invoiceRef/reference values."""
    _save_ledger({})
    return {"status": "reset"}
