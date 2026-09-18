"""Fire one demo scene through the running server and print what the agents did.

    python3 laura-demo/prompt.py lead "Jordan Rivera" +16164602717
    python3 laura-demo/prompt.py leak "<what the tenant said>"
    python3 laura-demo/prompt.py notice 2026-10-30
    python3 laura-demo/prompt.py close          # completes the latest leak work order

Needs laura-demo/server.py running (it hosts the agents).
"""
import json
import sys
import time
import urllib.request

BASE = "http://localhost:8430"
AGENT = {"lead": "Leads", "leak": "Maintenance", "notice": "Turn", "close": "Billing"}
DONE = {"lead": "Text", "leak": "Text", "notice": "Listing drafted", "close": "Waiting for a person"}


def call(path, body=None):
    req = urllib.request.Request(BASE + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def main():
    scene, args = sys.argv[1], sys.argv[2:]
    since = max([i["id"] for i in call("/api/feed")["items"]] or [0])
    t0 = time.time()
    if scene == "lead":
        r = call("/api/lead", {"name": args[0], "phone": args[1] if len(args) > 1 else ""})
    elif scene == "leak":
        r = call("/api/fixie", {"summary": args[0]})
    elif scene == "notice":
        r = call("/api/notice", {"moveOut": args[0]} if args else {})
    elif scene == "close":
        wo = next((i["data"]["workOrderID"] for i in reversed(call("/api/feed")["items"])
                   if i["agent"] == "Maintenance" and i["data"].get("workOrderID")), None)
        r = call("/api/complete", {"workOrderID": wo}) if wo else {"ok": False, "error": "no leak work order yet"}
    print("trigger:", json.dumps(r))
    if not r.get("ok"):
        return
    while time.time() - t0 < 150:
        for i in call(f"/api/feed?since={since}")["items"]:
            since = i["id"]
            if i["agent"] == AGENT[scene] and i["status"] != "working":
                print(f"+{time.time() - t0:4.0f}s  {i['step']}" + (f"\n        {i['detail']}" if i["detail"] else ""))
                if i["step"].startswith(DONE[scene]):
                    return
        time.sleep(1)
    print("timed out waiting for the agent")


if __name__ == "__main__":
    main()
