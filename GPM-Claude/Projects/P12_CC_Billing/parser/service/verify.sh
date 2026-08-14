#!/usr/bin/env bash
# Verify a deployed parser service end to end.
#
# Run this after EVERY deploy. It is the only thing that proves the container's
# poppler build still parses these statements the way the local test suite says
# it should — `-layout` column spacing varies between poppler releases, and a
# column moved one character is exactly the kind of change that shows up as a
# mysterious parse failure months later rather than as an obvious upgrade.
#
#   export GPM_PARSER_SECRET=...      (same shell you deployed from)
#   ./verify.sh
#
# The secret is read from the environment and never printed, never passed on a
# command line where `ps` could see it, and never written to disk.
set -euo pipefail

PROJECT="${GPM_PROJECT:-gen-lang-client-0079586443}"
REGION="${GPM_REGION:-us-central1}"
SERVICE="${GPM_SERVICE:-gpm-statement-parser}"

if [ -z "${GPM_PARSER_SECRET:-}" ]; then
  echo "GPM_PARSER_SECRET is not set in this shell."
  echo "It only lives in the terminal tab you generated it in — open the tab you"
  echo "deployed from, or generate a new one and redeploy."
  exit 1
fi

# Asked for rather than hardcoded: Cloud Run now issues two hostnames per
# service and this is the one it considers canonical.
URL="$(gcloud run services describe "$SERVICE" \
        --project "$PROJECT" --region "$REGION" \
        --format 'value(status.url)')"

echo "service : $URL"
echo "secret  : ${#GPM_PARSER_SECRET} characters (value not shown)"
echo

echo "--- /health ---"
curl -fsS -m 30 "$URL/health"
echo
echo

echo "--- /parse, against every statement in ../../input ---"
URL="$URL" python3 - <<'PY'
import base64, glob, json, os, sys, urllib.request

url    = os.environ['URL'] + '/parse'
secret = os.environ['GPM_PARSER_SECRET']
pdfs   = sorted(glob.glob(os.path.join(os.path.dirname(__file__) or '.', '../../input/*.pdf')))

if not pdfs:
    print('  no PDFs found in ../../input — nothing to verify against')
    sys.exit(1)

bad = 0
for path in pdfs:
    name = os.path.basename(path)
    with open(path, 'rb') as fh:
        payload = json.dumps({'pdf_base64': base64.b64encode(fh.read()).decode()}).encode()
    req = urllib.request.Request(
        url, data=payload,
        headers={'Content-Type': 'application/json', 'X-GPM-Secret': secret})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=180))
    except Exception as exc:                                   # noqa: BLE001
        print(f'  {name:<44} REQUEST FAILED: {exc}')
        bad += 1
        continue

    s = r['summary']
    flag = 'OK  ' if r['ok'] else 'FAIL'
    print(f"  {flag} {name:<44} {s['checks_passed']}/{s['checks_total']} checks  "
          f"{s['charge_count']:>3} charges  {s['credit_count']} credits  "
          f"${s['purchases_total']:>10,.2f}  {s['elapsed_seconds']}s")
    if not r['ok']:
        bad += 1
        for c in r['checks']:
            if not c['ok']:
                print(f"         FAILED: {c['name']} — {c['detail']}")

print()
print(f"  poppler in the container: {r['poppler']}")
print('  (validated locally on 26.07.0 — a different build here is fine as long')
print('   as every check above passes, which is the whole point of checking.)')
sys.exit(1 if bad else 0)
PY

echo
echo "All statements verified."
