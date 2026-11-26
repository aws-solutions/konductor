"""Job 4: customer statements in text and HTML (CBSTM03A and CBSTM03B; REQUIREMENTS R6 to R8)."""
from decimal import Decimal

from carddemo_port.editing import balance_amount, statement_amount
from carddemo_port.errors import DataError

TEXT_WIDTH = 80
HTML_WIDTH = 100
ZERO = Decimal("0.00")
RULE = "-" * 80

# The fixed HTML lines of CBSTM03A (the 88-level values), continuation lines joined as written (R7).
_STYLE = 'padding:0px 5px;'
HTML = {
    "L01": "<!DOCTYPE html>",
    "L02": '<html lang="en">',
    "L03": "<head>",
    "L04": '<meta charset="utf-8">',
    "L05": "<title>HTML Table Layout</title>",
    "L06": "</head>",
    "L07": '<body style="margin:0px;">',
    "L08": '<table  align="center" frame="box" style="width:70%; font:12px Segoe UI,sans-serif;">',
    "TRS": "<tr>",
    "TRE": "</tr>",
    "TDE": "</td>",
    "L10": '<td colspan="3" style="%sbackground-color:#1d1d96b3;">' % _STYLE,
    "L15": '<td colspan="3" style="%sbackground-color:#FFAF33;">' % _STYLE,
    "L16": '<p style="font-size:16px">Bank of XYZ</p>',
    "L17": "<p>410 Terry Ave N</p>",
    "L18": "<p>Seattle WA 99999</p>",
    "L22": '<td colspan="3" style="%sbackground-color:#f2f2f2;">' % _STYLE,
    "L30": '<td colspan="3" style="%sbackground-color:#33FFD1; text-align:center;">' % _STYLE,
    "L31": '<p style="font-size:16px">Basic Details</p>',
    "L43": '<p style="font-size:16px">Transaction Summary</p>',
    "L47": '<td style="width:25%; padding:0px 5px; background-color:#33FF5E; text-align:left;">',
    "L48": '<p style="font-size:16px">Tran ID</p>',
    "L50": '<td style="width:55%; padding:0px 5px; background-color:#33FF5E; text-align:left;">',
    "L51": '<p style="font-size:16px">Tran Details</p>',
    "L53": '<td style="width:20%; padding:0px 5px; background-color:#33FF5E; text-align:right;">',
    "L54": '<p style="font-size:16px">Amount</p>',
    "L58": '<td style="width:25%; padding:0px 5px; background-color:#f2f2f2; text-align:left;">',
    "L61": '<td style="width:55%; padding:0px 5px; background-color:#f2f2f2; text-align:left;">',
    "L64": '<td style="width:20%; padding:0px 5px; background-color:#f2f2f2; text-align:right;">',
    "L75": "<h3>End of Statement</h3>",
    "L78": "</table>",
    "L79": "</body>",
    "L80": "</html>",
}


def _fixed(*names):
    return [HTML[n] for n in names]


def _string_into(*parts):
    """COBOL STRING of (text, delimiter) pairs: each text is cut at its first delimiter, if any."""
    out = ""
    for text, delim in parts:
        if delim is not None and delim in text:
            text = text[:text.index(delim)]
        out += text
    return out


def _cut_double_blank(text, width):
    """`text` padded to its field `width`, then cut at the first two blanks in a row (DELIMITED BY '  ')."""
    padded = text.ljust(width)
    at = padded.find("  ")
    return padded if at < 0 else padded[:at]


def _html_head(account_id):
    return (_fixed("L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "TRS", "L10")
            + ["<h3>Statement for Account Number: " + account_id.ljust(20) + "</h3>"]
            + _fixed("TDE", "TRE", "TRS", "L15", "L16", "L17", "L18", "TDE", "TRE", "TRS", "L22"))


def _html_tail():
    return _fixed("TRS", "L10", "L75", "TDE", "TRE", "L78", "L79", "L80")


def statement(customer, account, trans):
    """Return (text_lines, html_lines, total) for one card: the customer, the account and its transactions.

    `trans` must already be in transaction id order. Lines are unpadded.
    """
    name = _string_into((customer.first, " "), (" ", None), (customer.middle, " "), (" ", None),
                        (customer.last, " "), (" ", None)).ljust(75)[:75]
    add1 = customer.addr1.ljust(50)[:50]
    add2 = customer.addr2.ljust(50)[:50]
    add3 = _string_into((customer.addr3, " "), (" ", None), (customer.state, " "), (" ", None),
                        (customer.country, " "), (" ", None), (customer.zip, " "), (" ", None)).ljust(80)[:80]
    acct = account.id.ljust(20)
    balance = balance_amount(account.balance)
    fico = customer.fico.ljust(20)

    text = ["*" * 31 + "START OF STATEMENT" + "*" * 31, name.ljust(80), add1.ljust(80), add2.ljust(80), add3, RULE,
            " " * 33 + "Basic Details".ljust(14) + " " * 33, RULE,
            "Account ID         :" + acct + " " * 40,
            "Current Balance    :" + balance + " " * 47,
            "FICO Score         :" + fico + " " * 40,
            RULE, " " * 30 + "TRANSACTION SUMMARY " + " " * 30, RULE,
            "Tran ID         ".ljust(16) + "Tran Details".ljust(51) + "  Tran Amount", RULE]
    html = _html_head(account.id)
    html += ['<p style="font-size:16px">' + _cut_double_blank(name[:50], 50) + "  </p>",
             "<p>" + _cut_double_blank(add1, 50) + "  </p>",
             "<p>" + _cut_double_blank(add2, 50) + "  </p>",
             "<p>" + _cut_double_blank(add3, 80) + "  </p>"]
    html += _fixed("TDE", "TRE", "TRS", "L30", "L31", "TDE", "TRE", "TRS", "L22")
    html += ["<p>Account ID         : " + acct + "</p>", "<p>Current Balance    : " + balance + "</p>",
             "<p>FICO Score         : " + fico + "</p>"]
    html += _fixed("TDE", "TRE", "TRS", "L30", "L43", "TDE", "TRE", "TRS", "L47", "L48", "TDE", "L50", "L51", "TDE",
                   "L53", "L54", "TDE", "TRE")
    total = ZERO
    for tran in trans:
        tran_id = tran.id.ljust(16)
        details = tran.desc.ljust(49)[:49]
        amount = statement_amount(tran.amount)
        text.append(tran_id + " " + details + "$" + amount)
        html += _fixed("TRS", "L58") + ["<p>" + tran_id + "</p>"] + _fixed("TDE", "L61") + ["<p>" + details + "</p>"]
        html += _fixed("TDE", "L64") + ["<p>" + amount + "</p>"] + _fixed("TDE", "TRE")
        total += tran.amount
    text += [RULE, "Total EXP:" + " " * 56 + "$" + statement_amount(total), "*" * 32 + "END OF STATEMENT" + "*" * 32]
    html += _html_tail()
    return text, html, total


def build_statements(trans, xref, customers, accounts):
    """Return (text_lines, html_lines, statements, transactions, skipped) for the cards in cardxref.txt.

    Cards are taken in card number order and each card's transactions in id order (R6). A card whose customer or
    account record is not found gets no statement and is counted in `skipped` (R8). A repeated (card, id) pair in
    `trans` raises DataError.
    """
    by_card = {}
    seen = set()
    for tran in trans:
        if (tran.card, tran.id) in seen:
            raise DataError("transact.txt: a card and transaction id appear twice")
        seen.add((tran.card, tran.id))
        by_card.setdefault(tran.card, []).append(tran)
    text, html, count, skipped = [], [], 0, 0
    for card in sorted(xref):
        row = xref[card]
        if row.customer not in customers or row.account not in accounts:
            skipped += 1
            continue
        mine = sorted(by_card.get(card, []), key=lambda t: t.id)
        t, h, _ = statement(customers[row.customer], accounts[row.account], mine)
        text += t
        html += h
        count += len(mine)
    return text, html, len(xref) - skipped, count, skipped
