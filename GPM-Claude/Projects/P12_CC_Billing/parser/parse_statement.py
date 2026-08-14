#!/usr/bin/env python3
"""
Deterministic parser for First National Bank of Michigan / Elan Financial
business credit-card statements. No model involved.

WHY THIS CAN EXIST AT ALL
-------------------------
statementParse.js's header claims these PDFs "defeat text extraction (custom
font encoding shifts letters, digits extract as whitespace)". Half true, wrong
conclusion. The fonts ARE subsetted CID TrueType with Identity-H encoding, so a
naive scrape of the content stream does return garbage — but every font ships a
ToUnicode CMap, and any extractor that honours it (poppler's pdftotext does)
decodes them exactly. Verified 2026-08-13 against the real June and July 2026
statements.

Producer is `Ricoh AFP2PDF Plus`, an AFP-to-PDF converter used by statement
print shops, so the layout comes off a fixed template and is stable month to
month. A template change is a once-in-years event, and it is exactly what the
checks below exist to catch.

  NOTE: this needs poppler's `pdftotext -layout` and therefore CANNOT run
  inside Apps Script — all 37 content streams are FlateDecode and GAS has no
  zlib inflate. It is built to sit behind an HTTPS endpoint that GAS calls.

WHAT THE STATEMENT PROVES ABOUT ITSELF
--------------------------------------
Every statement prints its own answer key:

  * one "Purchases" grand total
  * one "Other Credits" grand total
  * one "Total for Account ####" subtotal PER CARD  (~16 of them)

That is ~18 independent checks per file. For a parse to be silently wrong on
money it would have to make offsetting errors inside a single card's block.

  THE CHECKS ARE SILENT ON dates, ref numbers and vendor text. A parser could
  pass all 18 and still swap post/trans dates on every row. That is what the
  structural rules (_structural_checks) are for, and why a burn-in diff against
  the model parse is worth doing before trusting this alone.

LAYOUT CONTRACT
---------------
  Transactions   LAST,FIRST          Credit Limit $N   <- cardholder block opens
  Transactions   BILLING ACCOUNT ACTIVITY              <- master account, never billable
    Post   Trans
    Date   Date  Ref #  Transaction Description  Amount  Notation
                    Purchases and Other Debits          <- section
    MM/DD  MM/DD  9213  RYLEE'S ACE HARDWARE GR MI  $41.31
                    Other Credits                       <- section (refunds)
    MM/DD  MM/DD  8580  MENARDS WYOMING MI          $25.44CR
                    Payments and Other Credits          <- master only, EXCLUDED
    Total for Account #### #### #### 5892     $1,187.04 <- closes the block

A block SPANS PAGES: the `Transactions` heading repeats on the continuation
page but the section subheading does NOT. So a heading must never reset the
section, and only `Total for Account` closes a block. Getting that wrong
silently drops every continuation-page line — the same page-break trap the
model prompt warns about, hit from the opposite direction.
"""

from __future__ import annotations

import datetime as _dt
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field, asdict

# ---------------------------------------------------------------- patterns --

# "Transactions    GREEN,MARTIN W    Credit Limit $50000"
# "Transactions    BILLING ACCOUNT ACTIVITY"
RE_BLOCK_HEAD = re.compile(r'^Transactions\s{2,}(.+?)(?:\s{2,}Credit Limit\s.*)?\s*$')

# "  06/17   06/16   9213   RYLEE'S ACE HARDWARE GRAND RAPIDS MI      $41.31"
# Ref is 2-6 alphanumerics; the master account uses ET / MTC rather than digits.
RE_TXN = re.compile(
    r'^\s+(\d{2}/\d{2})\s+(\d{2}/\d{2})\s+([A-Z0-9]{2,6})\s+'
    r'(\S.*?)\s+\$([\d,]+\.\d{2})(CR)?\s*$'
)

# "    Total for Account #### #### #### 5892        $1,187.04"
RE_BLOCK_TOTAL = re.compile(
    r'^\s+Total for Account\s+(?:#+\s+)*(\d{4})\s+\$([\d,]+\.\d{2})(CR)?\s*$'
)

# Page 1 is a TWO-COLUMN layout, so these labels share a line with unrelated
# left-column prose ("Late Payment Warning: ...   Purchases   +   $18,590.47").
# Must be `search`, never `match`.
RE_TOTAL_PURCHASES = re.compile(r'\bPurchases\s+\+\s+\$([\d,]+\.\d{2})\s*$')
RE_TOTAL_CREDITS = re.compile(r'\bOther Credits\s+-\s+\$([\d,]+\.\d{2})(?:CR)?\s*$')

# Printed only in the page header of continuation pages, never on page 1:
#   "July 2026 Statement 06/12/2026 - 07/14/2026     Page 2 of 11"
RE_PERIOD = re.compile(r'(\d{2}/\d{2}/\d{4})\s*-\s*(\d{2}/\d{2}/\d{4})')

MASTER_BLOCK = 'BILLING ACCOUNT ACTIVITY'


SECTION_DEBITS = 'Purchases and Other Debits'
SECTION_CREDITS = 'Other Credits'
SECTION_PAYMENTS = 'Payments and Other Credits'   # master account only

# ---- Every non-blank line that may legally appear inside a block ----
#
# THIS IS THE ONLY CHECK THAT COVERS VENDOR TEXT. Every other check compares
# totals, so a line the parser simply does not recognise is invisible to all of
# them: it contributes nothing to any sum and nothing complains. That is how a
# new line type — a fee, a foreign-currency conversion line, an annotation this
# issuer has never printed before — would slip through unnoticed.
#
# So: anything inside a block that is neither a transaction nor recognised
# furniture is reported as a failed check. Not an exception — the caller should
# fall back to the model parse and have a human look, not crash.
#
# (Wrapped vendor names are NOT a risk here: this issuer hard-truncates the
# description to the column width rather than wrapping, which is why the real
# data carries strings like "BIRCH TREE BARK & STON" and "NAWARA BROTHERS HOME
# S". The Merchant Map seed keys are truncated for the same reason.)
ALLOWED_NOISE = [
    re.compile(r'^\s*Post\s+Trans\s*$'),
    re.compile(r'^\s*Date\s+Date\s+Ref\s*#\s+Transaction Description'),
    re.compile(r'^\s*Continued on Next Page\s*$'),
    re.compile(r'^\s*' + re.escape(SECTION_DEBITS) + r'\s*$'),
    re.compile(r'^\s*' + re.escape(SECTION_CREDITS) + r'\s*$'),
    re.compile(r'^\s*' + re.escape(SECTION_PAYMENTS) + r'\s*$'),
    re.compile(r'Elan Financial Service'),                 # page header
    re.compile(r'CPN\s*\d+'),                              # page header
    re.compile(r'Statement\s+\d{2}/\d{2}/\d{4}\s*-'),      # page header
    re.compile(r'Page\s+\d+\s+of\s+\d+'),                  # page header
    # Transaction annotations printed on their own line under a charge. These
    # are descriptive only and carry no money.
    re.compile(r'^\s*MERCHANDISE/SERVICE RETURN\s*$'),
]


def _is_known_noise(line: str) -> bool:
    return any(p.search(line) for p in ALLOWED_NOISE)

# A charge posts 0-10 days after it transacts. Observed range on real data is
# 1-4 and varies by merchant; 10 is a loose upper bound whose only job is to
# catch a post/trans column swap, which the money checksums cannot see.
MAX_POST_LAG_DAYS = 10
# Transaction dates run EARLIER than the printed open date (the July statement
# opens 06/12 by post date and carries trans dates of 06/11), so the window has
# to be slack on the low side.
PERIOD_SLACK_BEFORE = _dt.timedelta(days=15)
PERIOD_SLACK_AFTER = _dt.timedelta(days=5)


def _cents(text: str) -> int:
    """Money is carried in whole cents everywhere. Summing floats and comparing
    to a printed total is exactly how a phantom $0.01 delta gets invented."""
    return round(float(text.replace(',', '')) * 100)


class ParseError(Exception):
    """Raised only for a document this parser will not guess at."""


# ------------------------------------------------------------------ models --

@dataclass
class Txn:
    post_date: str
    trans_date: str
    ref: str
    vendor: str
    amount: float          # always positive; `is_credit` carries the direction
    cardholder: str
    is_credit: bool
    line_no: int

    def as_schema(self) -> dict:
        """The shape statementParse.js's STATEMENT_SCHEMA already produces, so
        this is a drop-in for the model's output rather than a new contract."""
        return {
            'post_date': self.post_date,
            'trans_date': self.trans_date,
            'ref': self.ref,
            'vendor': self.vendor,
            'amount': self.amount,
            'cardholder': self.cardholder,
        }


@dataclass
class Block:
    """One card's run of transactions, closed by its `Total for Account` line.

    Keyed on the CARD, not the cardholder name: one person can hold two cards,
    in which case the same name opens two blocks with two different totals. The
    prototype summed by name and would have failed both checks for such a
    person — no one on the June or July statements holds two cards, so it
    passed by luck rather than by being right.
    """
    cardholder: str
    card: str = ''
    printed_total_cents: int | None = None
    printed_is_credit: bool = False
    txns: list = field(default_factory=list)
    start_line: int = 0

    @property
    def net_cents(self) -> int:
        return sum(-t.amount_cents if t.is_credit else t.amount_cents for t in self.txns)


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ''


# ------------------------------------------------------------------ parsing --

def extract_text(pdf_path: str) -> str:
    """`-layout` preserves the column geometry the patterns above rely on.

    Separators are matched as `\\s+` rather than fixed offsets, so a different
    poppler build spacing the columns slightly differently does not break the
    parse — only the ORDER of the columns is load-bearing.
    """
    try:
        proc = subprocess.run(
            ['pdftotext', '-layout', pdf_path, '-'],
            capture_output=True, text=True, check=True,
        )
    except FileNotFoundError:
        raise ParseError('pdftotext (poppler) is not installed on this host.')
    except subprocess.CalledProcessError as exc:
        raise ParseError(f'pdftotext failed: {exc.stderr.strip()[:200]}')
    if not proc.stdout.strip():
        raise ParseError('pdftotext returned no text — is this a scanned image?')
    return proc.stdout


def find_period(lines: list[str]) -> tuple[_dt.date, _dt.date]:
    for line in lines:
        m = RE_PERIOD.search(line)
        if m:
            return (_dt.datetime.strptime(m.group(1), '%m/%d/%Y').date(),
                    _dt.datetime.strptime(m.group(2), '%m/%d/%Y').date())
    raise ParseError('no statement period (MM/DD/YYYY - MM/DD/YYYY) found.')


def resolve_year(mmdd: str, start: _dt.date, end: _dt.date) -> _dt.date:
    """Transaction lines print MM/DD with no year.

    The period is the only sound source for it, and the one case that actually
    goes wrong is a December/January statement, where a single period spans two
    years and picking the wrong one moves a charge twelve months. Candidates
    are scored by distance to the period, so 12/28 on a Dec-Jan statement
    resolves to the earlier year and 01/03 to the later one.
    """
    month, day = (int(part) for part in mmdd.split('/'))
    best: _dt.date | None = None
    best_gap: int | None = None
    for year in sorted({start.year, end.year}):
        try:
            cand = _dt.date(year, month, day)
        except ValueError:      # 02/29 in a non-leap year
            continue
        if cand < start:
            gap = (start - cand).days
        elif cand > end:
            gap = (cand - end).days
        else:
            gap = 0
        if best_gap is None or gap < best_gap:
            best, best_gap = cand, gap
    if best is None:
        raise ParseError(f'date {mmdd} is not a real calendar date in {start.year}/{end.year}.')
    return best


def parse(pdf_path: str) -> dict:
    return parse_text(extract_text(pdf_path))


def parse_text(text: str) -> dict:
    """Split out from parse() so the negative tests can feed it DELIBERATELY
    CORRUPTED text. A suite of checks nobody has ever seen fail is decoration —
    test_parser.py mutates real statement text and asserts each check catches
    its own failure mode."""
    lines = text.split('\n')
    start, end = find_period(lines)

    printed_purchases: int | None = None
    printed_credits: int | None = None

    blocks: list[Block] = []
    current: Block | None = None
    section: str | None = None
    orphans: list[int] = []          # txn lines seen with no open block
    unrecognized: list[tuple[int, str]] = []   # see ALLOWED_NOISE

    for line_no, raw in enumerate(lines, start=1):
        if printed_purchases is None:
            m = RE_TOTAL_PURCHASES.search(raw)
            if m:
                printed_purchases = _cents(m.group(1))
                continue
        if printed_credits is None:
            m = RE_TOTAL_CREDITS.search(raw)
            if m:
                printed_credits = _cents(m.group(1))
                continue

        m = RE_BLOCK_HEAD.match(raw)
        if m:
            name = m.group(1).strip()
            if current is None:
                current = Block(cardholder=name, start_line=line_no)
            else:
                # A continuation page repeats the heading mid-block. Same name
                # means the same block continues; `section` MUST survive,
                # because the continuation page does not reprint it.
                current.cardholder = name
            continue

        stripped = raw.strip()
        if stripped == SECTION_DEBITS:
            section = 'debits'
            continue
        if stripped == SECTION_CREDITS:
            section = 'credits'
            continue
        if stripped == SECTION_PAYMENTS:
            section = 'payments'
            continue

        m = RE_BLOCK_TOTAL.match(raw)
        if m:
            if current is None:
                raise ParseError(f'line {line_no}: "Total for Account" with no open block.')
            current.card = m.group(1)
            current.printed_total_cents = _cents(m.group(2))
            current.printed_is_credit = bool(m.group(3))
            blocks.append(current)
            current, section = None, None
            continue

        m = RE_TXN.match(raw)
        if m:
            if current is None:
                orphans.append(line_no)
                continue
            post, trans, ref, desc, amount, cr = m.groups()
            # THE `CR` SUFFIX IS THE AUTHORITATIVE SIGNAL, not the section
            # subheading. Every credit line prints it ($25.44CR), and relying
            # on section state instead was a real fragility: within a block the
            # order is `Other Credits` FIRST and `Purchases and Other Debits`
            # second, so a statement that ever dropped the debits subheading
            # would silently reclassify every following charge as a refund —
            # 93 of them on the July file. The money checks do catch it (a
            # misclassified line moves a card's net by twice its value), but a
            # check catching it is worse than not depending on it at all.
            #
            # `section` is kept for diagnostics only. Master-account payments
            # are excluded by their block's cardholder, not by their section.
            txn = Txn(
                post_date=resolve_year(post, start, end).isoformat(),
                trans_date=resolve_year(trans, start, end).isoformat(),
                ref=ref,
                vendor=re.sub(r'\s{2,}', ' ', desc).strip(),
                amount=_cents(amount) / 100,
                cardholder=current.cardholder,
                is_credit=bool(cr),
                line_no=line_no,
            )
            txn.amount_cents = _cents(amount)     # type: ignore[attr-defined]
            txn.section = section                 # type: ignore[attr-defined]
            current.txns.append(txn)
            continue

        # Fell through every pattern. Inside a block that is a line type this
        # parser has never seen, and no total will ever notice it.
        if current is not None and raw.strip() and not _is_known_noise(raw):
            unrecognized.append((line_no, raw.strip()[:90]))

    if current is not None:
        raise ParseError(
            f'block for "{current.cardholder}" opened at line {current.start_line} '
            'was never closed by a "Total for Account" line.'
        )

    charges = [t for b in blocks if b.cardholder != MASTER_BLOCK
               for t in b.txns if not t.is_credit]
    credits = [t for b in blocks if b.cardholder != MASTER_BLOCK
               for t in b.txns if t.is_credit]

    return {
        'period': (start, end),
        'blocks': blocks,
        'charges': charges,
        'credits': credits,
        'printed_purchases': printed_purchases,
        'printed_credits': printed_credits,
        'orphans': orphans,
        'unrecognized': unrecognized,
        'text': text,
    }


# ------------------------------------------------------------------- checks --

def money_checks(parsed: dict) -> list[Check]:
    """The statement's own answer key. Everything here compares a number we
    computed against a number the bank printed."""
    checks: list[Check] = []

    sum_charges = sum(t.amount_cents for t in parsed['charges'])
    printed = parsed['printed_purchases']
    if printed is None:
        checks.append(Check('purchases total printed', False, 'no "Purchases +" line found'))
    else:
        d = sum_charges - printed
        checks.append(Check(
            'purchases total', d == 0,
            f'parsed ${sum_charges/100:,.2f} vs printed ${printed/100:,.2f} (delta ${d/100:,.2f})'))

    sum_credits = sum(t.amount_cents for t in parsed['credits'])
    printed_c = parsed['printed_credits'] or 0
    d = sum_credits - printed_c
    checks.append(Check(
        'credits total', d == 0,
        f'parsed ${sum_credits/100:,.2f} vs printed ${printed_c/100:,.2f} (delta ${d/100:,.2f})'))

    for b in parsed['blocks']:
        want = -b.printed_total_cents if b.printed_is_credit else b.printed_total_cents
        got = b.net_cents
        checks.append(Check(
            f'card {b.card} ({b.cardholder})', got == want,
            f'parsed ${got/100:,.2f} vs printed ${want/100:,.2f}'))

    return checks


def structural_checks(parsed: dict) -> list[Check]:
    """What the money checks CANNOT see.

    Every check above compares totals, so any error that preserves a total is
    invisible to them — most importantly a post/trans date column swap, which
    would leave every dollar correct and destroy the reconciliation date gate.
    """
    checks: list[Check] = []
    start, end = parsed['period']
    txns = parsed['charges'] + parsed['credits']

    checks.append(Check('no orphan transaction lines', not parsed['orphans'],
                        f'lines {parsed["orphans"][:10]}' if parsed['orphans'] else ''))
    checks.append(Check('at least one charge parsed', bool(parsed['charges']),
                        f'{len(parsed["charges"])} charges'))

    bad_lag = [t for t in txns
               if not (0 <= (_dt.date.fromisoformat(t.post_date)
                             - _dt.date.fromisoformat(t.trans_date)).days <= MAX_POST_LAG_DAYS)]
    checks.append(Check(
        f'post date is 0-{MAX_POST_LAG_DAYS} days after trans date', not bad_lag,
        '; '.join(f'line {t.line_no} {t.trans_date}->{t.post_date}' for t in bad_lag[:5])))

    lo, hi = start - PERIOD_SLACK_BEFORE, end + PERIOD_SLACK_AFTER
    out = [t for t in txns if not (lo <= _dt.date.fromisoformat(t.trans_date) <= hi)]
    checks.append(Check(
        f'every trans date within {lo} .. {hi}', not out,
        '; '.join(f'line {t.line_no} {t.trans_date}' for t in out[:5])))

    unrec = parsed['unrecognized']
    checks.append(Check(
        'every line inside a block is recognised', not unrec,
        '; '.join(f'line {n}: {t!r}' for n, t in unrec[:5])
        + (f' (+{len(unrec) - 5} more)' if len(unrec) > 5 else '')))

    thin = [t for t in txns if len(t.vendor) < 3]
    checks.append(Check('every vendor is at least 3 characters', not thin,
                        '; '.join(f'line {t.line_no} {t.vendor!r}' for t in thin[:5])))

    noref = [t for t in txns if not t.ref]
    checks.append(Check('every transaction has a ref #', not noref,
                        '; '.join(str(t.line_no) for t in noref[:5])))

    nameless = [t for t in txns if not t.cardholder or t.cardholder == MASTER_BLOCK]
    checks.append(Check('no billable line on the master account', not nameless,
                        '; '.join(str(t.line_no) for t in nameless[:5])))

    # NOT a failure. statementParse.js already warns about it and the plan file
    # treats ref # as the carry-forward key — this proves that assumption is
    # unsafe, on real data, every month.
    seen: dict[str, int] = {}
    dupes = sorted({t.ref for t in parsed['charges']
                    if (seen.setdefault(t.ref, 0) or True) and (seen.__setitem__(t.ref, seen[t.ref] + 1) or seen[t.ref] > 1)})
    checks.append(Check('ref #s unique (informational)', True,
                        f'DUPLICATES: {", ".join(dupes)}' if dupes else 'all unique'))

    return checks


def to_schema(parsed: dict) -> dict:
    """Exactly the object statementParse.js's STATEMENT_SCHEMA describes, so
    this can be swapped in behind the existing pipeline with no downstream
    change."""
    start, end = parsed['period']
    return {
        'statement_open_date': start.isoformat(),
        'statement_close_date': end.isoformat(),
        'purchases_total': (parsed['printed_purchases'] or 0) / 100,
        'charges': [t.as_schema() for t in parsed['charges']],
        'credits': [t.as_schema() for t in parsed['credits']],
        'credit_line_count': len(parsed['credits']),
        'parse_notes': '',
    }


# -------------------------------------------------------------------- cli ----

def report(pdf_path: str, show_rows: int = 0) -> bool:
    label = pdf_path.rsplit('/', 1)[-1]
    print(f'\n{"=" * 78}\n{label}\n{"=" * 78}')
    try:
        parsed = parse(pdf_path)
    except ParseError as exc:
        print(f'  REFUSED: {exc}')
        return False

    start, end = parsed['period']
    print(f'  period          {start} .. {end}')
    print(f'  cards           {len([b for b in parsed["blocks"] if b.cardholder != MASTER_BLOCK])}'
          f'  (+1 master account block)')
    print(f'  charges         {len(parsed["charges"])}')
    print(f'  credits         {len(parsed["credits"])}')

    money = money_checks(parsed)
    struct = structural_checks(parsed)

    print(f'\n  --- money checks ({len(money)}) — the statement\'s own answer key ---')
    for c in money:
        print(f'    {"PASS" if c.ok else "FAIL"}  {c.name:<34} {c.detail}')

    print(f'\n  --- structural checks ({len(struct)}) — what totals cannot see ---')
    for c in struct:
        print(f'    {"PASS" if c.ok else "FAIL"}  {c.name:<50} {c.detail}')

    if show_rows:
        print(f'\n  --- first {show_rows} charges ---')
        for t in parsed['charges'][:show_rows]:
            print(f'    {t.trans_date}  {t.post_date}  {t.ref:<5} '
                  f'${t.amount:>9,.2f}  {t.cardholder:<18} {t.vendor}')
        if parsed['credits']:
            print(f'\n  --- all {len(parsed["credits"])} credits ---')
            for t in parsed['credits']:
                print(f'    {t.trans_date}  {t.post_date}  {t.ref:<5} '
                      f'${t.amount:>9,.2f}  {t.cardholder:<18} {t.vendor}')

    failed = [c for c in money + struct if not c.ok]
    print(f'\n  RESULT: {len(money) + len(struct) - len(failed)}/{len(money) + len(struct)} checks pass'
          f'{"" if not failed else "  *** " + str(len(failed)) + " FAILED ***"}')
    return not failed


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith('--')]
    as_json = '--json' in argv
    rows = 8 if '--rows' in argv else 0

    if not args:
        print(__doc__)
        return 2

    if as_json:
        print(json.dumps(to_schema(parse(args[0])), indent=2))
        return 0

    return 0 if all([report(p, rows) for p in args]) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
