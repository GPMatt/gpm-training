#!/usr/bin/env python3
"""
Build the synthetic FNBM/Elan statement for the P12 test run.

WHY A SYNTHETIC STATEMENT. Part 2 refuses to run without a parsed statement
(_requireReconciledStatement in billingCycle.js) — that is the standing rail
"nothing bills without a matching statement charge" enforced in code. The test
has no real statement to work from, so it needs one that (a) Claude's PDF
document block can read with the production prompt unchanged, and (b) contains
charges designed to drive every branch of the matcher rather than six clean
matches that prove almost nothing.

WHY IT MIMICS THE REAL LAYOUT SO CLOSELY. The parse prompt in statementParse.js
describes this exact document: Open/Closing dates near the top, a printed
purchases total, and charges grouped under a cardholder HEADING in LAST,FIRST
form that has to be carried down across page breaks. A generic invoice-looking
PDF would test the prompt against a document it was not written for, and a
parse failure would be a test artifact rather than a finding. Reference:
  GPM-Claude/Projects/P12_CC_Billing/input/2026-06-11 Statement - Card...2284 (1).pdf

USAGE
  ./venv/bin/python make_test_statement.py spec.json out.pdf

The spec is filled in from what "Test — Propose Test Rows" reports. Vendor
strings must match the receipts' real Merchant (col T): _upsertMerchantMap and
_upsertGLMemoryForBilledRows learn from whatever bills, and those tables are
permanent, so a fabricated vendor would be a permanent wrong pairing rather
than a discardable test artifact.
"""

import json
import sys
from datetime import datetime

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

W, H = letter
LEFT = 0.85 * inch
RIGHT = W - 0.85 * inch


def money(v):
    return "${:,.2f}".format(v)


def mmdd(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%m/%d")


def mmddyyyy(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%m/%d/%Y")


def month_year(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%B %Y")


class Statement:
    def __init__(self, c, spec, total_pages):
        self.c = c
        self.spec = spec
        self.total_pages = total_pages
        self.page = 0

    # The masthead repeats on every page exactly as the real statement does —
    # the prompt tells Claude to read continuation pages and carry the current
    # cardholder heading across them, so the page furniture has to look the
    # same on page 3 as on page 1 for that instruction to mean anything.
    def header(self):
        c, s = self.c, self.spec
        self.page += 1
        y = H - 0.6 * inch

        c.setFont("Helvetica-Bold", 15)
        c.drawCentredString(LEFT + 1.35 * inch, y - 22, "FIRST NATIONAL BANK")
        c.setFont("Helvetica-Oblique", 10)
        c.drawRightString(LEFT + 2.35 * inch, y - 34, "of Michigan")
        c.setLineWidth(1.2)
        c.line(LEFT + 0.1 * inch, y - 8, LEFT + 2.6 * inch, y - 8)

        y -= 62
        c.setFont("Helvetica-Bold", 10)
        c.drawString(LEFT, y, "%s  Statement" % month_year(s["close_date"]))
        c.setFont("Helvetica", 10)
        c.drawRightString(RIGHT, y, "Page %d of %d" % (self.page, self.total_pages))

        y -= 14
        c.setFont("Helvetica", 10)
        c.drawString(LEFT, y, "Open Date: %s  Closing Date: %s"
                     % (mmddyyyy(s["open_date"]), mmddyyyy(s["close_date"])))
        c.drawRightString(RIGHT, y, "Account Ending in:  #### #### #### %s" % s["card_last4"])

        y -= 16
        c.setFont("Helvetica-Bold", 10)
        c.drawString(LEFT, y, "Visa® Business Bonus Rewards Card")
        c.drawRightString(RIGHT - 1.15 * inch, y, "Elan Financial Services")

        y -= 16
        c.setFont("Helvetica", 10)
        c.drawString(LEFT, y, s["company"])
        c.setFont("Helvetica", 9)
        c.drawRightString(RIGHT, y, "1-866-552-8855")
        return y - 24

    # The Activity Summary box. `Purchases` here is what the prompt calls
    # "the total for PURCHASES as printed on the statement", and
    # _summarizeCharges compares the sum of the charge lines against it in whole
    # cents — so this number is generated from the charges, never hand-typed,
    # or the test would fail on a phantom penny that says nothing about the code.
    def summary_box(self, y, purchases_total):
        c = self.c
        bx, bw = LEFT + 3.05 * inch, RIGHT - (LEFT + 3.05 * inch)
        rows = [
            ("Previous Balance", "+", money(0.0)),
            ("Payments", "-", "$0.00"),
            ("Other Credits", "", "$0.00"),
            ("Purchases", "+", money(purchases_total)),
            ("Balance Transfers", "", "$0.00"),
            ("Advances", "", "$0.00"),
            ("Other Debits", "", "$0.00"),
            ("Fees Charged", "", "$0.00"),
            ("Interest Charged", "", "$0.00"),
        ]
        bh = 22 + len(rows) * 14 + 40
        c.setLineWidth(0.8)
        c.rect(bx, y - bh, bw, bh)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(bx + 6, y - 16, "Activity Summary")

        ry = y - 34
        c.setFont("Helvetica", 9.5)
        for label, sign, amt in rows:
            c.drawString(bx + 6, ry, label)
            c.drawString(bx + bw - 118, ry, sign)
            c.drawRightString(bx + bw - 8, ry, amt)
            ry -= 14

        c.line(bx + bw - 110, ry + 9, bx + bw - 8, ry + 9)
        ry -= 4
        c.setFont("Helvetica-Bold", 10)
        c.drawString(bx + 6, ry, "New Balance")
        c.drawString(bx + bw - 118, ry, "=")
        c.drawRightString(bx + bw - 8, ry, money(purchases_total))
        ry -= 16
        c.drawString(bx + 6, ry, "Minimum Payment Due")
        c.drawRightString(bx + bw - 8, ry, "$0.00")
        return y - bh - 20

    def band(self, y, left_text, mid_text="", right_text=""):
        c = self.c
        c.setFillColorRGB(0.85, 0.85, 0.85)
        c.rect(LEFT, y - 15, RIGHT - LEFT, 17, stroke=0, fill=1)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(LEFT + 4, y - 11, left_text)
        if mid_text:
            c.setFont("Helvetica-Bold", 10)
            c.drawString(LEFT + 1.5 * inch, y - 11, mid_text)
        if right_text:
            c.drawRightString(RIGHT - 4, y - 11, right_text)
        return y - 26

    def column_heads(self, y):
        c = self.c
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(LEFT + 4, y, "Post")
        c.drawString(LEFT + 46, y, "Trans")
        y -= 10
        c.drawString(LEFT + 4, y, "Date")
        c.drawString(LEFT + 46, y, "Date")
        c.drawString(LEFT + 92, y, "Ref #")
        c.drawString(LEFT + 138, y, "Transaction Description")
        c.drawRightString(RIGHT - 62, y, "Amount")
        c.drawRightString(RIGHT - 4, y, "Notation")
        y -= 8

        c.setFillColorRGB(0.88, 0.88, 0.88)
        c.rect(LEFT + 20, y - 13, RIGHT - LEFT - 24, 15, stroke=0, fill=1)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString((LEFT + RIGHT) / 2, y - 9, "Purchases and Other Debits")
        return y - 26

    def charge_line(self, y, ch):
        c = self.c
        c.setFont("Helvetica", 9)
        c.drawString(LEFT + 4, y, mmdd(ch["post_date"]))
        c.drawString(LEFT + 46, y, mmdd(ch["trans_date"]))
        c.drawString(LEFT + 92, y, str(ch["ref"]))
        c.drawString(LEFT + 138, y, ch["vendor"])
        c.drawRightString(RIGHT - 62, y, money(ch["amount"]))
        c.setLineWidth(0.6)
        c.line(RIGHT - 56, y - 2, RIGHT - 4, y - 2)
        return y - 15

    def account_total(self, y, total, last4):
        c = self.c
        c.setFont("Helvetica-Bold", 9)
        c.drawString(LEFT + 138, y, "Total for Account #### #### #### %s" % last4)
        c.drawRightString(RIGHT - 62, y, money(total))
        return y - 22

    def footer_continued(self):
        self.c.setFont("Helvetica-Oblique", 9)
        self.c.drawCentredString(W / 2, 0.6 * inch, "Continued on Next Page")


def build(spec, out_path):
    charges = []
    for group in spec["cardholders"]:
        for ch in group["charges"]:
            charges.append(dict(ch, cardholder=group["name"], last4=group.get("last4", spec["card_last4"])))
    purchases_total = round(sum(c["amount"] for c in charges), 2)

    # Two passes: the page count goes in the header ("Page 1 of N"), so the
    # layout has to be measured before it is drawn.
    for measuring in (True, False):
        c = canvas.Canvas(out_path, pagesize=letter)
        st = Statement(c, spec, total_pages=(1 if measuring else pages_needed))
        y = st.header()
        y = st.summary_box(y, purchases_total)

        page_count = 1
        for group in spec["cardholders"]:
            block_height = 26 + 26 + len(group["charges"]) * 15 + 22
            if y - block_height < 1.0 * inch:
                if not measuring:
                    st.footer_continued()
                c.showPage()
                page_count += 1
                y = st.header()

            y = st.band(y, "Transactions", group["name"],
                        "Credit Limit  $%s" % spec.get("credit_limit", "50000"))
            y = st.column_heads(y)
            for ch in group["charges"]:
                y = st.charge_line(y, ch)
            y = st.account_total(
                y, round(sum(x["amount"] for x in group["charges"]), 2),
                group.get("last4", spec["card_last4"]))

        if measuring:
            pages_needed = page_count
        else:
            c.save()

    return purchases_total, charges


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)

    with open(sys.argv[1]) as fh:
        spec = json.load(fh)

    total, charges = build(spec, sys.argv[2])

    print("Wrote %s" % sys.argv[2])
    print("  Period:          %s to %s" % (spec["open_date"], spec["close_date"]))
    print("  Cardholders:     %d" % len(spec["cardholders"]))
    print("  Charges:         %d" % len(charges))
    print("  Purchases total: %s   <- _summarizeCharges compares the line sum to this" % money(total))
    print()
    print("  Ref #s must be unique — statementParse checks for duplicates:")
    refs = [str(c["ref"]) for c in charges]
    dupes = {r for r in refs if refs.count(r) > 1}
    print("    %s" % ("OK, all distinct" if not dupes else "DUPLICATES: %s" % ", ".join(sorted(dupes))))


if __name__ == "__main__":
    main()
