# GPM statement parser — Cloud Run service

Deterministic extraction of FNBM/Elan credit-card statements. Apps Script posts
a PDF, gets back charges and credits plus the result of every self-check the
statement makes possible.

**Nothing in P12 calls this yet.** Deploying it changes no live behaviour.

---

## Why Cloud Run and not a Cloud Function

The parser shells out to poppler's `pdftotext -layout`, and no managed Python
runtime ships poppler. `-layout` is also what preserves the column geometry the
patterns depend on, and its spacing behaviour varies between poppler releases —
so owning the image is what makes the deployed binary the same one the test
suite was validated against.

It cannot run in Apps Script at all: every content stream in these PDFs is
`FlateDecode` and GAS has no zlib inflate.

---

## What you need to do

### 1. Confirm the project and billing

```bash
gcloud auth login
gcloud projects list
```

Pick the project P11's delinquency pipeline already uses if there is one —
reusing it keeps billing and IAM in one place. Then:

```bash
export GPM_PROJECT=<project-id>
export GPM_REGION=us-central1
gcloud config set project "$GPM_PROJECT"
```

Billing must be enabled on the project or `run deploy` fails at the build step.

### 2. Enable the APIs

```bash
gcloud services enable run.googleapis.com \
                       cloudbuild.googleapis.com \
                       artifactregistry.googleapis.com
```

### 3. Generate a shared secret

```bash
export GPM_PARSER_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
echo "$GPM_PARSER_SECRET"
```

**Save this.** It goes into the GAS project's Script Properties as
`STATEMENT_PARSER_SECRET`, next to the other secrets — never onto the Config
tab, which anyone with sheet edit access can read.

### 4. Deploy

```bash
cd parser/service
./deploy.sh
```

It prints the service URL. That URL goes into Script Properties as
`STATEMENT_PARSER_URL`.

### 5. Verify the deployed poppler matches what was tested

This is the one post-deploy check that actually matters:

```bash
curl -s "$URL/health"
```

Compare the reported `poppler` version to the one your local runs print. If they
differ, re-run the parse against both statements **through the deployed
service** before trusting it:

```bash
python3 - <<'PY'
import base64, json, os, urllib.request, glob
url, secret = os.environ['URL'], os.environ['GPM_PARSER_SECRET']
for f in sorted(glob.glob('../../input/*.pdf')):
    pdf = open(f, 'rb').read()
    req = urllib.request.Request(url + '/parse',
        data=json.dumps({'pdf_base64': base64.b64encode(pdf).decode()}).encode(),
        headers={'Content-Type': 'application/json', 'X-GPM-Secret': secret})
    r = json.load(urllib.request.urlopen(req))
    print(f.split('/')[-1], '->', r['ok'], r['failed'] or '', r['summary']['checks_passed'],
          '/', r['summary']['checks_total'])
PY
```

Expect `True` and `28/28` for both. Anything else means the container's poppler
spaces a column differently and the patterns need a look — **which is exactly
the failure this check exists to surface, and why the version is echoed in
every response.**

---

## Security posture, and its limit

The service is deployed `--allow-unauthenticated` and gated on a shared secret
header, compared in constant time. That is a deliberate trade:

- **What it protects.** The endpoint stores nothing, reads nothing, and returns
  only what it was sent. A leaked secret lets someone burn CPU parsing their own
  PDFs. It exposes none of your data.
- **What it does not.** Anyone holding the secret can call it. If that is not
  acceptable, the upgrade is `--no-allow-unauthenticated` plus a service account
  and an OIDC token minted in GAS — more moving parts, and worth doing only if
  the threat model changes.

Rotate by re-running `deploy.sh` with a new `GPM_PARSER_SECRET` and updating the
Script Property. There is no state to migrate.

---

## API

```
GET  /health           -> {ok, poppler}                    (unauthenticated)
POST /parse            -> see below
     X-GPM-Secret: <secret>
     {"pdf_base64": "..."}
```

```jsonc
{
  "ok": true,                  // true ONLY when every check passed
  "statement": { ... },        // exactly STATEMENT_SCHEMA's shape — a drop-in
  "checks":  [ {name, ok, detail}, ... ],
  "failed":  [],               // names of failed checks
  "summary": { charge_count, credit_count, card_count, purchases_total,
               checks_passed, checks_total, elapsed_seconds, ... },
  "poppler": "pdftotext version 24.02.0"
}
```

**`ok: false` returns HTTP 200.** A failed check is a real, expected answer —
"this statement no longer matches the layout I was built for" — not an error.
Returning 4xx would make a normal outcome indistinguishable from the service
being down. Only a malformed request is 4xx; only a crash is 5xx.

---

## How GAS should use it (not yet built)

1. POST the statement PDF.
2. `ok: true` → use `statement` directly. No model call, no cost, ~0.1s.
3. `ok: false`, or any transport failure → **fall back to the existing Opus
   parse so billing is never blocked**, and file an error report via
   `_logErrorReport` so the diagnosis Routine drafts a parser-fix PR.
4. Either way, put `failed` and `summary` into the parse report so the operator
   sees which path ran and why.

Burn-in: run both parsers and diff every field for the first 2–3 cycles. The
money checks cannot verify dates, refs or vendor text, and a diff against the
model parse is the only thing that does.
