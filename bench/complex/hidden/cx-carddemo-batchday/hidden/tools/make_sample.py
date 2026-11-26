#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Write the sample input files of cx-carddemo-batchday (`data/` in the fixture) from the upstream CardDemo data.

Usage: make_sample.py UPSTREAM_ASCII_DIR OUT_DIR

UPSTREAM_ASCII_DIR is app/data/ASCII of aws-samples/aws-mainframe-modernization-carddemo at 59cc6c2f. The upstream
files have CRLF line ends and a few blank-padded gaps; every output line ends in LF. The daily transactions are
made here (seeded, grouped by card as a sorted daily file is), so the sample hits: every reject code (100 to 104), a group rate, a credit balance, an expired
account, a card with more than ten transactions, two cards on one account, a customer with no middle name, and a
report of several pages. Run it again to get the same bytes.
"""
import random
import sys
from pathlib import Path

POS, NEG = "{ABCDEFGHI", "}JKLMNOPQR"


def zoned(cents, width):
    digits = str(abs(cents)).zfill(width)
    return digits[:-1] + (NEG if cents < 0 else POS)[int(digits[-1])]


def cents_of(field):
    last = field[-1]
    neg = last in NEG
    digit = (NEG if neg else POS).index(last)
    value = int(field[:-1] + str(digit))
    return -value if neg else value


def read(path, width):
    return [l.rstrip("\r\n").ljust(width) for l in Path(path).read_text().splitlines() if l.strip()]


def put(path, lines):
    Path(path).write_text("".join(l + "\n" for l in lines))


def main(up, out):
    up, out = Path(up), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(20261126)

    accts = read(up / "acctdata.txt", 300)
    xref = read(up / "cardxref.txt", 50)
    cust = read(up / "custdata.txt", 500)
    cats = read(up / "tcatbal.txt", 50)
    disc = read(up / "discgrp.txt", 50)
    types = read(up / "trantype.txt", 60)
    tcat = read(up / "trancatg.txt", 60)

    def set_acct(n, **f):
        i = n - 1
        line = accts[i]
        if "group" in f:
            line = line[:112] + f["group"].ljust(10) + line[122:]
        if "expiry" in f:
            line = line[:58] + f["expiry"] + line[68:]
        if "limit" in f:
            line = line[:24] + zoned(f["limit"], 12) + line[36:]
        accts[i] = line

    set_acct(2, group="A000000000")
    set_acct(3, group="A000000000")
    set_acct(4, group="ZEROAPR")
    set_acct(5, expiry="2022-01-31")
    set_acct(6, limit=30000)
    # Account 50 has a card but no account record: reject 101. It also loses its category balance row.
    gone = accts.pop(49)
    assert gone.startswith("00000000050")
    cats = [c for c in cats if not c.startswith("00000000050")]

    # A second card on account 1, lower than its first, so the lowest-card rule (I5) matters.
    xref.append("0000000000000001" + "000000001" + "00000000001" + " " * 14)

    # Category balances: positive on most accounts, a credit balance on 7, two more categories on 9.
    rows = []
    for c in cats:
        n = int(c[:11])
        cents = 25000 + (n * 13731) % 300000
        if n == 7:
            cents = -12345
        rows.append(c[:17] + zoned(cents, 11) + c[28:])
    rows.append("00000000009" + "010002" + zoned(98765, 11) + " " * 22)
    rows.append("00000000009" + "020001" + zoned(-5000, 11) + " " * 22)
    cats = sorted(rows, key=lambda r: r[:17])

    # Customers: 3 has no middle name, 4 a two-word first name, 5 no second address line.
    def edit(n, start, width, text):
        i = n - 1
        cust[i] = cust[i][:start] + text.ljust(width) + cust[i][start + width:]

    edit(3, 34, 25, "")
    edit(4, 9, 25, "Mary Ann")
    edit(5, 134, 50, "")

    valid = [(t[:2], t[2:6]) for t in tcat]
    purchases = [("01", "0001"), ("01", "0002"), ("01", "0003"), ("01", "0004")]
    cards = {}
    for line in xref:
        cards[line[:16]] = line[25:36]
    card_list = sorted(cards)
    # Card of account 50 (no account record) and of account 6 (small limit), by account id.
    by_acct = {}
    for card, acct in cards.items():
        by_acct.setdefault(acct, []).append(card)

    trans = []
    counter = [0]

    def tran(card, amount, kind=purchases, day=None, ident=None, desc=None, orig=None):
        counter[0] += 1
        t, c = rnd.choice(kind) if isinstance(kind, list) else kind
        day = day or rnd.randint(1, 28)
        stamp = orig or "2022-06-%02d %02d:%02d:%02d.000000" % (day, rnd.randint(0, 23), rnd.randint(0, 59), rnd.randint(0, 59))
        ident = ident or "%016d" % (8000000000 + counter[0] * 7)
        desc = desc if desc is not None else "%s at Shop %d" % ("Payment" if amount < 0 else "Purchase", rnd.randint(10, 99))
        trans.append(ident.ljust(16) + t + c + "POS TERM  " + desc.ljust(100) + zoned(amount, 11) + "%09d" % rnd.randint(1, 999)
                     + ("Shop %d" % rnd.randint(1, 99)).ljust(50) + "Town".ljust(50) + "12345".ljust(10) + card.ljust(16)
                     + stamp.ljust(26) + " " * 26 + " " * 20)

    first = lambda n: by_acct["%011d" % n][0]
    # 14 purchases on one card: statements must hold more than ten per card.
    for _ in range(14):
        tran(first(1), rnd.randint(500, 9000))
    # Ordinary activity on about twenty other cards, a payment now and then.
    for n in [2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]:
        for _ in range(rnd.randint(1, 3)):
            tran(first(n), rnd.randint(300, 12000))
        if n % 4 == 0:
            tran(first(n), -rnd.randint(500, 3000), kind=[("02", "0001"), ("02", "0002")])
    tran(first(7), 1500, kind=[("05", "0001")])
    # Rejects: unknown card (100) twice, no account record (101), over limit (102), expired account (103) twice.
    tran("9999999999999999", 1000)
    tran("9999999999999998", 2500)
    tran(first(50), 1200)
    tran(first(6), 45000)
    tran(first(6), 32000)
    tran(first(5), 1000, day=10)
    tran(first(5), 2000, day=11)
    # Duplicate transaction ids (104): the second copy of two earlier ids.
    dup1, dup2 = trans[3][:16], trans[20][:16]
    tran(first(12), 999, ident=dup1)
    tran(first(13), 888, ident=dup2)
    # Two cards of one account, the lower one with a transaction (I5, statements per card).
    tran("0000000000000001", 2345)
    # A transaction with an odd type and category pair, to reach the other lookups.
    tran(first(30), 777, kind=[("03", "0001")])
    assert all((l[16:18], l[18:22]) in valid for l in trans)

    put(out / "acctdata.txt", accts)
    put(out / "cardxref.txt", xref)
    put(out / "custdata.txt", cust)
    put(out / "tcatbal.txt", cats)
    put(out / "discgrp.txt", disc)
    put(out / "trantype.txt", types)
    put(out / "trancatg.txt", tcat)
    put(out / "dailytran.txt", trans)


if __name__ == "__main__":
    main(*sys.argv[1:3])
