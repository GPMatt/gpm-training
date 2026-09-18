"""Dress the Rentvine sandbox as GPM's West Michigan portfolio for the Laura demo.

Renames properties, units, portfolios and owner contacts through the API (all verified live
2026-09-18: property/unit/portfolio/owner updates persist; property/unit CREATE is still blocked,
W11). Every original value is saved to seed_state.json (gitignored) before it's changed, so
--revert puts the sandbox back exactly as it was.

Acceptance criteria:
  1. Dry-run is the default; nothing is written without --live.
  2. Every write is re-fetched and compared; a silent no-op is reported, not trusted.
  3. Re-running is safe: records already at their target values are skipped.
  4. --revert restores every field recorded in seed_state.json, then clears it.
  5. [CLAIMS-TEST] records are never touched.

Usage (from P20_Rentvine-Demos/):
  python3 laura-demo/seed.py            # dry run
  python3 laura-demo/seed.py --live
  python3 laura-demo/seed.py --revert --live
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import rv  # noqa: E402

STATE = os.path.join(HERE, "seed_state.json")

# propertyID -> (display name, street address, city, ZIP). Made-up house numbers on real streets.
PROPERTIES = {
    "10": ("Knapp's Corner Apartments", "2150 Knapp St NE", "Grand Rapids", "49505"),
    "5": ("Alger Heights Apartments", "1458 Alger St SE", "Grand Rapids", "49507"),
    "1": ("1142 Lake Dr SE", "1142 Lake Dr SE", "Grand Rapids", "49506"),
    "2": ("827 Fuller Ave NE", "827 Fuller Ave NE", "Grand Rapids", "49503"),
    "3": ("2319 Breton Rd SE", "2319 Breton Rd SE", "Grand Rapids", "49546"),
    "4": ("615 Leonard St NW", "615 Leonard St NW", "Grand Rapids", "49504"),
    "6": ("4410 Division Ave S", "4410 Division Ave S", "Wyoming", "49548"),
    "7": ("3375 Burton St SE", "3375 Burton St SE", "Grand Rapids", "49546"),
    "8": ("1920 Plainfield Ave NE", "1920 Plainfield Ave NE", "Grand Rapids", "49505"),
    "9": ("6801 Cherry Ave SE", "6801 Cherry Ave SE", "Kentwood", "49508"),
    "11": ("540 Wealthy St SE", "540 Wealthy St SE", "Grand Rapids", "49503"),
    "12": ("2745 28th St SW", "2745 28th St SW", "Wyoming", "49519"),
}

# Portfolios whose names read as test data. Real-looking ones (Jon Smith, Jane Anderson, ...) stay.
PORTFOLIOS = {
    "5": "Reeds Lake Holdings LLC",
    "7": "Fulton Street Rentals LLC",
    "8": "Heritage Hill Properties LLC",
    "9": "Cascade Ridge Investments LLC",
}

ADDR_FIELDS = ("name", "address", "address2", "city", "stateID", "postalCode")


def load_state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {"original": {}}


def save_state(state):
    json.dump(state, open(STATE, "w"), indent=2)


def unwrap(body, key):
    return body.get(key, body) if isinstance(body, dict) else {}


def all_units():
    s, b = rv.get("properties/units?pageSize=500")
    return [r["unit"] for r in b] if s == 200 else []


def unit_suffix(unit):
    """'#101' from address2, else the trailing letter of names like '9856A'."""
    if unit.get("address2"):
        return unit["address2"].strip()
    tail = (unit.get("name") or "")[-1:]
    return f"Unit {tail}" if tail.isalpha() else ""


def plan():
    """Yield (key, path, current record, target fields) for every write."""
    units = all_units()
    for pid, (name, street, city, zip_) in PROPERTIES.items():
        prop = unwrap(rv.get(f"properties/{pid}")[1], "property")
        if not prop.get("propertyID"):
            print(f"  ! property {pid} not found, skipped")
            continue
        yield f"property/{pid}", f"properties/{pid}", prop, \
            {"name": name, "address": street, "city": city, "stateID": "MI", "postalCode": zip_}
        mine = [u for u in units if u["propertyID"] == pid]
        for u in mine:
            suffix = unit_suffix(u) if len(mine) > 1 else ""
            target = {"name": f"{street} {suffix}".strip(), "address": street, "address2": suffix or None,
                      "city": city, "stateID": "MI", "postalCode": zip_}
            yield f"unit/{u['unitID']}", f"properties/{pid}/units/{u['unitID']}", u, target
    for fid, name in PORTFOLIOS.items():
        pf = unwrap(rv.get(f"portfolios/{fid}")[1], "portfolio")
        yield f"portfolio/{fid}", f"portfolios/{fid}", pf, {"name": name}
        # Single-owner test portfolios: the owner contact carries the same test name, so rename it too.
        if len(pf.get("contacts") or []) == 1:
            cid = pf["contacts"][0]["contactID"]
            owner = unwrap(rv.get(f"owners/{cid}")[1], "contact")
            yield f"owner/{cid}", f"owners/{cid}", owner, {"name": name}


def apply(live):
    state = load_state()
    changed = skipped = failed = 0
    for key, path, cur, target in plan():
        if "[CLAIMS-TEST]" in json.dumps(cur):
            continue
        diff = {k: v for k, v in target.items() if (cur.get(k) or None) != (v or None)}
        if not diff:
            skipped += 1
            continue
        print(f"  {key}: {cur.get('name')!r} -> {target.get('name')!r}")
        if not live:
            continue
        state["original"].setdefault(key, {"path": path, "fields": {k: cur.get(k) for k in target}})
        save_state(state)  # record the original before writing, so a crash can still be reverted
        s, b = rv.post(path, target)
        back = unwrap(rv.get(path)[1], key.split("/")[0] if key.split("/")[0] != "owner" else "contact")
        if key.startswith("unit/"):
            back = next((u for u in all_units() if u["unitID"] == key.split("/")[1]), {})
        missed = {k: back.get(k) for k in diff if (back.get(k) or None) != (target[k] or None)}
        if s == 200 and not missed:
            changed += 1
        else:
            failed += 1
            print(f"    ! HTTP {s}; not persisted on re-fetch: {missed or str(b)[:200]}")
    print(f"{'changed' if live else 'would change'} {changed if live else '(see above)'}; "
          f"already done {skipped}; failed {failed}" + ("" if live else "  (dry run: add --live)"))


def revert(live):
    state = load_state()
    for key, rec in state["original"].items():
        print(f"  revert {key} -> {rec['fields'].get('name')!r}")
        if live:
            s, b = rv.post(rec["path"], rec["fields"])
            if s != 200:
                print(f"    ! HTTP {s}: {str(b)[:200]}")
    if live:
        save_state({"original": {}})
    else:
        print("(dry run: add --live)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--revert", action="store_true")
    a = ap.parse_args()
    revert(a.live) if a.revert else apply(a.live)
