"""Tiny Rentvine manager-API client shared by the P20 tools.

Credentials come from P20_Rentvine-Demos/.env (never hardcoded - this repo is public).
"""
import base64
import json
import os
import urllib.error
import urllib.request

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_env():
    path = os.path.join(_ROOT, ".env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()
BASE = os.environ.get("RV_BASE", "").rstrip("/")
_AUTH = base64.b64encode(
    f"{os.environ.get('RV_KEY', '')}:{os.environ.get('RV_SECRET', '')}".encode()
).decode()


def call(method, path, body=None):
    """Return (http_status, parsed_json_or_text). Never raises on HTTP errors."""
    req = urllib.request.Request(
        f"{BASE}/{path.lstrip('/')}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Basic {_AUTH}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, raw = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read().decode()
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw


def get(path):
    return call("GET", path)


def post(path, body=None):
    return call("POST", path, body)


def to_e164(phone):
    """Rentvine rejects anything but +1XXXXXXXXXX. Returns None if it can't be normalized."""
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def upload(path, filename, data, content_type="application/pdf"):
    """multipart/form-data POST with a single `file` part. Returns (status, json_or_text)."""
    boundary = "----gpmrv" + os.urandom(8).hex()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{BASE}/{path.lstrip('/')}", method="POST", data=body, headers={
        "Authorization": f"Basic {_AUTH}", "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, raw = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read().decode()
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw
