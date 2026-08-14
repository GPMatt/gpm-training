#!/usr/bin/env python3
"""
Negative tests for parse_statement.py.

A suite of checks nobody has ever seen fail is decoration. Every test here
takes REAL statement text, corrupts it in one specific way, and asserts that
the check built for that failure actually catches it — and, just as important,
that the checks which SHOULDN'T fire stay quiet.

The two most valuable cases are the ones the grand total cannot see:

  * moving a line between two cards  -> grand total still balances, two card
    subtotals break. This is the failure the model parse is structurally blind
    to, and the whole reason the per-card checks exist.
  * swapping the post and trans date columns -> every money check passes and
    the dates are wrecked. Money checksums are silent here by construction.

Run:  python3 test_parser.py            (uses the two statements in ../input)
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from parse_statement import (          # noqa: E402
    parse_text, extract_text, money_checks, structural_checks, ParseError,
    RE_TXN, SECTION_DEBITS,
)

INPUT = Path(__file__).parent.parent / 'input'
JULY = INPUT / '2026-07-14 Statement - Card...2284.pdf'
JUNE = INPUT / '2026-06-11 Statement - Card...2284 (1).pdf'

_passed = 0
_failed = 0


def check(cond, label, detail=''):
    global _passed, _failed
    if cond:
        _passed += 1
    else:
        _failed += 1
        print(f'  FAIL  {label}' + (f'\n        {detail}' if detail else ''))


def run(text):
    """-> (failed_check_names, all_checks) for possibly-corrupted text."""
    p = parse_text(text)
    all_checks = money_checks(p) + structural_checks(p)
    return [c.name for c in all_checks if not c.ok], all_checks, p


def txn_line_indexes(lines):
    return [i for i, l in enumerate(lines) if RE_TXN.match(l)]


def main():
    if not JULY.exists():
        print(f'missing {JULY}')
        return 2

    july = extract_text(str(JULY))
    june = extract_text(str(JUNE)) if JUNE.exists() else None

    # ---------------------------------------------------------------- clean --
    print('\n--- baseline: unmodified statements must be completely clean ---')
    for label, text in (('July', july), ('June', june)):
        if text is None:
            continue
        failed, all_c, p = run(text)
        check(not failed, f'{label} passes every check', f'failed: {failed}')
        check(len(all_c) >= 25, f'{label} runs a meaningful number of checks ({len(all_c)})')

    lines = july.split('\n')
    idx = txn_line_indexes(lines)
    check(len(idx) > 200, f'found {len(idx)} transaction lines to corrupt')

    # ------------------------------------------------------- dropped a line --
    print('\n--- a dropped transaction line ---')
    victim = idx[50]
    failed, _, _ = run('\n'.join(lines[:victim] + lines[victim + 1:]))
    check('purchases total' in failed, 'dropping a line breaks the purchases total')
    check(any(f.startswith('card ') for f in failed), 'and breaks exactly the card it came from')
    check(sum(1 for f in failed if f.startswith('card ')) == 1,
          'only ONE card subtotal breaks, not several', f'failed: {failed}')

    # ------------------------------------------------- corrupted an amount ---
    print('\n--- a single mistyped digit in one amount ---')
    bad = lines[:]
    bad[victim] = re.sub(r'\$([\d,]+)\.(\d{2})', r'$\g<1>.99', bad[victim], count=1)
    failed, _, _ = run('\n'.join(bad))
    check('purchases total' in failed, 'a wrong cent value breaks the purchases total')

    # ---------------------------------- a line moved between two cardholders --
    print('\n--- a line moved from one card to another (grand total UNCHANGED) ---')
    # Take a line from an early block and re-insert it inside a later block.
    src = idx[5]
    dst = next(i for i in idx if i > src + 60)
    moved = lines[:src] + lines[src + 1:]
    dst_after_removal = dst - 1
    moved = moved[:dst_after_removal] + [lines[src]] + moved[dst_after_removal:]
    failed, all_c, _ = run('\n'.join(moved))
    check('purchases total' not in failed,
          'the GRAND TOTAL still balances — it cannot see this at all',
          f'failed: {failed}')
    card_fails = [f for f in failed if f.startswith('card ')]
    check(len(card_fails) == 2,
          'but TWO card subtotals break — this is what the model parse is blind to',
          f'card failures: {card_fails}')

    # -------------------------------------- post/trans date columns swapped --
    print('\n--- post and trans date columns swapped (all money still correct) ---')
    swapped = []
    for l in lines:
        m = RE_TXN.match(l)
        if m:
            post, trans = m.group(1), m.group(2)
            # Swap in place so column widths — and every amount — are untouched.
            l = l.replace(f'{post}   {trans}', f'{trans}   {post}', 1) \
                 .replace(f'{post}  {trans}', f'{trans}  {post}', 1)
        swapped.append(l)
    failed, all_c, _ = run('\n'.join(swapped))
    money_failed = [c.name for c in money_checks(parse_text('\n'.join(swapped))) if not c.ok]
    check(not money_failed,
          'EVERY money check still passes — dates are invisible to totals',
          f'unexpectedly failed: {money_failed}')
    check(any('post date is' in f for f in failed),
          'the structural post-lag check catches it', f'failed: {failed}')

    # ------------------------------- section subheadings must not be relied on --
    print('\n--- every section subheading deleted (classification must survive) ---')
    # Within a block the order is `Other Credits` FIRST, `Purchases and Other
    # Debits` second. An earlier version keyed credit-vs-debit off that section
    # state, so deleting the debits subheading reclassified all 93 following
    # charges as refunds. Classification now keys off the `CR` suffix alone,
    # which is printed on every credit line, so this is a no-op.
    stripped = [l for l in lines if l.strip() != SECTION_DEBITS]
    failed, _, p = run('\n'.join(stripped))
    check(len(p['charges']) == 246, 'no charge is reclassified when the subheading is gone',
          f'got {len(p["charges"])} charges')
    check(len(p['credits']) == 3, 'credits are still exactly the CR-suffixed lines',
          f'got {len(p["credits"])} credits')
    check(not failed, 'and every check still passes', f'failed: {failed}')

    # A credit misclassified as a charge moves its card's net by TWICE its
    # value, so the per-card check is what would catch a regression here.
    print('\n--- a credit stripped of its CR suffix ---')
    creditline = next(i for i, l in enumerate(lines) if RE_TXN.match(l) and l.rstrip().endswith('CR'))
    nocr = lines[:]
    nocr[creditline] = nocr[creditline].rstrip()[:-2]
    failed, _, _ = run('\n'.join(nocr))
    check('purchases total' in failed and 'credits total' in failed,
          'losing a CR suffix breaks BOTH grand totals')
    check(any(f.startswith('card ') for f in failed), 'and the card it belongs to')

    # -------------------------------------------- an unclosed block refuses --
    print('\n--- a truncated statement must REFUSE, never half-parse ---')
    cut = next(i for i, l in enumerate(lines) if 'Total for Account' in l)
    truncated = [l for l in lines if 'Total for Account' not in l]
    try:
        run('\n'.join(truncated))
        check(False, 'a block with no closing total must raise ParseError')
    except ParseError as e:
        check('never closed' in str(e), 'unclosed block refuses with a clear reason', str(e))

    # ------------------------------------------------- no period = refusal ---
    print('\n--- a document with no statement period must REFUSE ---')
    noperiod = re.sub(r'\d{2}/\d{2}/\d{4}\s*-\s*\d{2}/\d{2}/\d{4}', 'XX', july)
    try:
        run(noperiod)
        check(False, 'missing period must raise ParseError')
    except ParseError as e:
        check('period' in str(e), 'missing period refuses with a clear reason', str(e))

    # ---------------------------------- an unrecognised line inside a block --
    print('\n--- a line type the parser has never seen (invisible to every total) ---')
    injected = lines[:]
    injected.insert(idx[80] + 1, '   FOREIGN CURRENCY CONVERSION FEE          1.4210 EUR')
    failed, _, _ = run('\n'.join(injected))
    money_only = [f for f in failed if f == 'purchases total' or f.startswith('card ')]
    check(not money_only,
          'it contributes to NO total, so every money check still passes',
          f'unexpectedly failed: {money_only}')
    check(any('recognised' in f for f in failed),
          'the coverage check is the only thing that catches it', f'failed: {failed}')

    # ------------------------------------------------------ garbage input ----
    print('\n--- unrelated text must REFUSE, not return an empty success ---')
    try:
        failed, _, p = run('hello world\nthis is not a statement\n')
        check(False, 'garbage must raise, not parse to zero charges')
    except ParseError as e:
        check(True, 'garbage refuses')

    print('\n' + '=' * 46)
    print(f'{_passed} passed, {_failed} failed')
    return 1 if _failed else 0


if __name__ == '__main__':
    sys.exit(main())
