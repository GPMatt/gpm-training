"""
HTTPS wrapper around parse_statement.py, for Apps Script to call.

WHY THIS EXISTS AS A SERVICE AT ALL — the parser needs poppler, and Apps Script
cannot run it: every content stream in these PDFs is FlateDecode and GAS has no
zlib inflate. A GAS-native parser would have to reimplement inflate, PDF object
parsing, CID ToUnicode decoding and text positioning. So the extraction lives
here and GAS calls it.

CONTRACT
--------
POST /parse
  headers: X-GPM-Secret: <shared secret>
  body:    {"pdf_base64": "<base64 of the statement PDF>"}

  200 -> {
    "ok": bool,                 # true only when EVERY check passed
    "statement": {...},         # exactly STATEMENT_SCHEMA's shape
    "checks":  [{name, ok, detail}, ...],
    "failed":  ["name", ...],   # empty when ok
    "summary": {...},
    "poppler": "pdftotext version 24.02.0"
  }

`ok: false` is a 200, not an error. A failed check is a real, expected answer —
"this statement no longer matches the layout I was built for" — and the caller's
job is to fall back to the model parse and file a report. Returning 4xx/5xx for
it would make a normal outcome indistinguishable from the service being down.

Only a genuinely broken REQUEST is a 4xx, and only a crash is a 5xx.

THIS SERVICE STORES NOTHING. The PDF is parsed in memory and discarded. It has
no database, no bucket, no logging of statement contents — the only thing that
reaches the logs is a line count and the check results.
"""

from __future__ import annotations

import base64
import binascii
import os
import subprocess
import tempfile
import time
import traceback

from flask import Flask, jsonify, request

from parse_statement import (
    ParseError, money_checks, parse, structural_checks, to_schema,
)

app = Flask(__name__)

# Set at deploy time. Startup fails loudly rather than silently accepting
# anonymous requests, because "the auth check quietly did nothing" is not a
# state anyone would notice from the outside.
SHARED_SECRET = os.environ.get('GPM_PARSER_SECRET', '')

# A statement runs ~175KB. 20MB is generous enough for any plausible future
# statement and small enough that this can't be used to burn CPU on junk.
MAX_PDF_BYTES = 20 * 1024 * 1024


def _poppler_version() -> str:
    try:
        out = subprocess.run(['pdftotext', '-v'], capture_output=True, text=True)
        return (out.stderr or out.stdout).strip().split('\n')[0]
    except Exception:                                    # noqa: BLE001
        return 'unknown'


@app.route('/health', methods=['GET'])
def health():
    """NOT `/healthz`. Cloud Run runs on Knative, and `/healthz` is the classic
    Kubernetes health-check path — Google's frontend intercepts it before it
    ever reaches the container, so it returns Google's own 404 page while every
    other route works normally. That asymmetry is genuinely confusing to debug
    (the service looks dead when it is fine), so the endpoint is named `/health`
    and this comment is here to stop anyone renaming it back.

    Unauthenticated on purpose — it reveals nothing but liveness and the poppler
    build, and the poppler build is worth being able to check without holding
    the secret, since a silent version bump is the most likely cause of a parse
    that used to work and stopped."""
    return jsonify({'ok': True, 'poppler': _poppler_version()})


@app.route('/parse', methods=['POST'])
def parse_endpoint():
    if not SHARED_SECRET:
        # Misconfiguration, not a client error. Refusing everything is the only
        # safe response — the alternative is an open PDF-parsing endpoint.
        return jsonify({'error': 'service misconfigured: GPM_PARSER_SECRET is unset'}), 503

    # Constant-time compare so the secret can't be recovered a byte at a time.
    import hmac
    supplied = request.headers.get('X-GPM-Secret', '')
    if not hmac.compare_digest(supplied, SHARED_SECRET):
        return jsonify({'error': 'unauthorized'}), 401

    body = request.get_json(silent=True) or {}
    b64 = body.get('pdf_base64')
    if not b64:
        return jsonify({'error': 'body must be JSON with a "pdf_base64" field'}), 400

    try:
        pdf = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        return jsonify({'error': 'pdf_base64 is not valid base64'}), 400

    if len(pdf) > MAX_PDF_BYTES:
        return jsonify({'error': f'pdf exceeds {MAX_PDF_BYTES} bytes'}), 413
    if not pdf.startswith(b'%PDF'):
        return jsonify({'error': 'payload is not a PDF (no %PDF header)'}), 400

    started = time.time()
    # NamedTemporaryFile rather than a pipe because pdftotext wants a seekable
    # file. Deleted on close; nothing about the statement outlives the request.
    with tempfile.NamedTemporaryFile(suffix='.pdf') as fh:
        fh.write(pdf)
        fh.flush()
        try:
            parsed = parse(fh.name)
        except ParseError as exc:
            # A refusal, not a crash: the parser declined to guess. Same shape
            # as a failed check so the caller has one path for "cannot trust
            # this", not two.
            return jsonify({
                'ok': False,
                'statement': None,
                'checks': [{'name': 'parse', 'ok': False, 'detail': str(exc)}],
                'failed': ['parse'],
                'summary': {'refused': str(exc)},
                'poppler': _poppler_version(),
            })
        except Exception:                                # noqa: BLE001
            app.logger.error('unhandled parse failure\n%s', traceback.format_exc())
            return jsonify({'error': 'parser crashed — see service logs'}), 500

    checks = money_checks(parsed) + structural_checks(parsed)
    failed = [c.name for c in checks if not c.ok]

    start, end = parsed['period']
    app.logger.info(
        'parsed %s..%s: %d charges, %d credits, %d/%d checks pass, %.1fs',
        start, end, len(parsed['charges']), len(parsed['credits']),
        len(checks) - len(failed), len(checks), time.time() - started,
    )

    return jsonify({
        'ok': not failed,
        'statement': to_schema(parsed),
        'checks': [{'name': c.name, 'ok': c.ok, 'detail': c.detail} for c in checks],
        'failed': failed,
        'summary': {
            'period_start': start.isoformat(),
            'period_end': end.isoformat(),
            'charge_count': len(parsed['charges']),
            'credit_count': len(parsed['credits']),
            'card_count': len(parsed['blocks']),
            'purchases_total': (parsed['printed_purchases'] or 0) / 100,
            'checks_passed': len(checks) - len(failed),
            'checks_total': len(checks),
            'elapsed_seconds': round(time.time() - started, 2),
        },
        'poppler': _poppler_version(),
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
