"""Local server for the Laura demo: serves the story page, runs the agents, exposes scene triggers.

    python3 laura-demo/server.py        # then open http://localhost:8430

Credentials stay server-side (lib/rv.py reads ../.env); the page never sees them.

Scene triggers (each writes a real record to the Rentvine sandbox; the agents react to Rentvine's
own webhook or poll, never to the page directly):
  POST /api/lead      simulated Zillow inquiry -> real prospect in Rentvine        -> Leads agent (poll)
  POST /api/fixie     simulated Fixie chat     -> real work order in Rentvine      -> Maintenance agent (webhook)
  POST /api/notice    notice on the scene lease (same fields a PM fills in the UI) -> Turn agent (webhook)
  POST /api/complete  mark the scene WO Completed (same as the tech closing it)   -> Billing agent (webhook)
"""
import datetime
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agents  # noqa: E402
from agents import rv  # noqa: E402

PORT = 8430
ASSETS = os.path.join(HERE, "..", "vendor-ap-demo", "assets")
SCENE = {
    "lead_unit": "33",                                    # 2150 Knapp St NE #204, vacant
    "maint": {"propertyID": "4", "unitID": "4", "leaseID": "4"},   # 615 Leonard St NW, Danielle Ortiz
    "notice_lease": "3",                                  # 2319 Breton Rd SE, Marcus Bennett
    "ac": {"propertyID": "1", "unitID": "1", "leaseID": "1"},     # 1142 Lake Dr SE, owner Jon Smith
}
AC_MARK = "outdoor unit is humming but the fan isn't spinning"


def _body(handler):
    n = int(handler.headers.get("Content-Length") or 0)
    return json.loads(handler.rfile.read(n) or b"{}") if n else {}


def api_lead(b):
    name = (b.get("name") or "Jordan Rivera").strip()
    body = {"name": name, "email": b.get("email") or f"{re.sub(r'[^a-z]', '', name.lower())}.demo@example.com",
            "unitID": SCENE["lead_unit"], "message": b.get("message") or "Is the 2-bed still available?",
            "leadSource": "Zillow (simulated)"}
    phone = rv.to_e164(b.get("phone") or "")
    if phone:
        body["phone"] = phone
    s, r = rv.post("screening/prospects", body)
    pid = r.get("prospect", r).get("prospectID") if isinstance(r, dict) else None   # response is flat
    if not pid:  # Rentvine dedups on email + unit (W22): make the email unique and retry once
        body["email"] = body["email"].replace("@", f"+{datetime.datetime.now():%H%M%S}@")
        s, r = rv.post("screening/prospects", body)
        pid = r.get("prospect", r).get("prospectID") if isinstance(r, dict) else None
    return {"ok": bool(pid), "prospectID": pid, "http": s}


def api_fixie(b):
    summary = (b.get("summary") or "").strip()
    if not summary:
        return {"ok": False, "error": "summary required"}
    m = SCENE["maint"]
    body = {"propertyID": m["propertyID"], "unitID": m["unitID"], "leaseID": m["leaseID"], "isInternal": "0",
            "priorityID": "2", "workOrderStatusID": agents.STATUS_REQUESTED,
            "description": f"<p>{summary}</p><p><i>Intake: tenant chat assistant (simulated for the demo)</i></p>"}
    s, r = rv.post("maintenance/work-orders", body)
    wo = (r or {}).get("workOrder", {}) if isinstance(r, dict) else {}
    if s != 200:  # fall back to the verified minimal payload (W01)
        body.pop("leaseID")
        s, r = rv.post("maintenance/work-orders", body)
        wo = (r or {}).get("workOrder", {}) if isinstance(r, dict) else {}
    if wo.get("workOrderID"):
        # The intake conversation, so opening the work order shows how it started.
        said = b.get("tenantSaid") or summary
        chat = [("Assistant", "Hi Danielle, this is GPM's maintenance assistant. What's going on at 615 Leonard St NW?"),
                ("Danielle", said),
                ("Assistant", "Thanks. Is water still running? If you can, turn the shut-off valve under the sink."),
                ("Danielle", b.get("tenantFollowUp") or "I turned it off. The leak stopped but the cabinet is soaked."),
                ("Assistant", "Got it. I'm filing this with your maintenance team now; you'll get a text with a time.")]
        rv.post("chat/messages", {"chatObjectTypeID": 1, "objectID": int(wo["workOrderID"]), "isSharedWithTenant": "1",
                                  "message": "<p><b>Tenant intake chat</b></p><p>" + "<br>".join(
                                      f"<b>{w}:</b> {t}" for w, t in chat) + "</p>"})
    return {"ok": bool(wo.get("workOrderID")), "workOrderID": wo.get("workOrderID"),
            "workOrderNumber": wo.get("workOrderNumber"), "http": s, "error": None if s == 200 else str(r)[:300]}


def api_notice(b):
    lid = SCENE["notice_lease"]
    move_out = b.get("moveOut") or str(agents.business_day(datetime.date.today(), 30))
    s, _ = rv.post(f"leases/{lid}", {"noticeDate": str(datetime.date.today()), "expectedMoveOutDate": move_out})
    lease = agents.unwrap(rv.get(f"leases/{lid}")[1], "lease")
    return {"ok": lease.get("expectedMoveOutDate") == move_out, "leaseID": lid, "moveOut": move_out, "http": s}


def api_complete(b):
    wid = str(b.get("workOrderID") or "")
    if not wid:
        return {"ok": False, "error": "workOrderID required"}
    s, _ = rv.post(f"maintenance/work-orders/{wid}", {"workOrderStatusID": agents.STATUS_COMPLETED})
    return {"ok": agents.get_wo(wid).get("workOrderStatusID") == agents.STATUS_COMPLETED, "http": s}


def seed_ac_job():
    """Prompt 5's job: an open A/C work order at Lake Dr, already dispatched to Jake this morning."""
    agents.ensure_parts()
    for r in rv.get("maintenance/work-orders?pageSize=500")[1]:
        w = r["workOrder"]
        if AC_MARK in (w.get("description") or "") and w.get("workOrderStatusID") == agents.STATUS_OPEN:
            return w["workOrderID"]
    m, today = SCENE["ac"], datetime.date.today()
    s, r = rv.post("maintenance/work-orders", {
        "propertyID": m["propertyID"], "unitID": m["unitID"], "leaseID": m["leaseID"], "isInternal": "0",
        "priorityID": "3", "workOrderStatusID": agents.STATUS_OPEN, "technicianContactIDs": [agents.TECH["contactID"]],
        "description": f"<p>A/C not cooling: warm air from the vents; the {AC_MARK}.</p>",
        "scheduledStartDate": f"{today}", "scheduledEndDate": f"{today}",
        "appointmentWindowStartDateTime": f"{today} 07:00:00", "appointmentWindowEndDateTime": f"{today} 08:00:00"})
    wid = (r or {}).get("workOrder", {}).get("workOrderID") if isinstance(r, dict) else None
    if wid:
        agents.once("wo_created", wid, "seed")
    return wid


def api_invoice(b):
    wid = b.get("workOrderID") or seed_ac_job()
    parts = [(p["name"], float(p.get("qty", 1))) for p in b.get("parts") or []]
    import threading
    threading.Thread(target=agents.itemized_bill, args=(str(wid), float(b.get("hours") or 2), parts, b.get("notes", "")),
                     daemon=True).start()
    return {"ok": True, "workOrderID": wid}


def api_reset(b):
    # Clear the scene-3 notice so it can be recorded again, forget handled events, seed prompt 5's job.
    rv.post(f"leases/{SCENE['notice_lease']}", {"noticeDate": None, "expectedMoveOutDate": None})
    agents.reset()
    return {"ok": True, "acWorkOrder": seed_ac_job()}


ROUTES = {"/api/lead": api_lead, "/api/fixie": api_fixie, "/api/notice": api_notice,
          "/api/complete": api_complete, "/api/reset": api_reset, "/api/invoice": api_invoice}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/":
            self._send(200, open(os.path.join(HERE, "index.html"), "rb").read(), "text/html; charset=utf-8")
        elif path == "/api/feed":
            since = int((re.search(r"since=(\d+)", query) or [0, 0])[1])
            self._send(200, {"items": [i for i in agents.FEED if i["id"] > since],
                             "config": {"webhooks": bool(agents.TOKEN), "allowlisted": len(agents.ALLOWLIST),
                                        "lastHookAgo": round(time.time() - agents.LAST_HOOK[0])
                                        if agents.LAST_HOOK[0] else None}})
        elif path.startswith("/assets/") and re.fullmatch(r"/assets/[\w.-]+\.png", path):
            f = os.path.join(ASSETS, path.split("/")[-1])
            self._send(200, open(f, "rb").read(), "image/png") if os.path.exists(f) else self._send(404, {})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        fn = ROUTES.get(self.path)
        if not fn:
            return self._send(404, {"error": "not found"})
        try:
            self._send(200, fn(_body(self)))
        except Exception as e:
            self._send(500, {"ok": False, "error": str(e)[:300]})


if __name__ == "__main__":
    agents.start()
    print(f"Laura demo on http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
