"""Job 3: the daily transaction report (CBTRN03C; REQUIREMENTS R1 to R5)."""
from decimal import Decimal

from carddemo_port.editing import detail_amount, total_amount
from carddemo_port.errors import DataError

WIDTH = 133
PAGE_SIZE = 20
ZERO = Decimal("0.00")
RULE = "-" * WIDTH
HEADER_1 = ("Transaction ID".ljust(17) + "Account ID".ljust(12) + "Transaction Type".ljust(19)
            + "Tran Category".ljust(35) + "Tran Source".ljust(14) + " " + "        Amount".ljust(16))


def _name_header(start, end):
    return "DALYREPT".ljust(38) + "Daily Transaction Report".ljust(41) + "Date Range: " + start + " to " + end


def _total_line(label, label_width, amount):
    return label.ljust(label_width) + "." * (112 - 15 - label_width) + total_amount(amount)


def _detail_line(tran, account_id, type_desc, cat_desc):
    return (tran.id.ljust(16) + " " + account_id + " " + tran.type_cd + "-" + type_desc[:15].ljust(15) + " "
            + tran.cat_cd + "-" + cat_desc[:29].ljust(29) + " " + tran.source.ljust(10) + "    "
            + detail_amount(tran.amount))


def build_report(trans, xref, types, cats, start, end):
    """Return (lines, detail_count). `lines` are unpadded; `trans` are transact.txt records in file order.

    start, end: YYYY-MM-DD, inclusive, compared with the date part of the processed timestamp.
    A card, type or category that is not found raises DataError (R4).
    """
    out = []
    counter = 0           # every line written counts, as WS-LINE-COUNTER does; it drives the page breaks
    page = account = grand = ZERO
    current = None
    details = 0

    def write(line):
        nonlocal counter
        out.append(line)
        counter += 1

    def headers():
        write(_name_header(start, end))
        write("")
        write(HEADER_1)
        write(RULE)

    def page_total():
        nonlocal page, grand
        write(_total_line("Page Total", 11, page))
        grand += page
        page = ZERO
        write(RULE)

    def account_total():
        nonlocal account
        write(_total_line("Account Total", 13, account))
        account = ZERO
        write(RULE)

    for tran in trans:
        if not start <= tran.proc_ts[:10] <= end:
            break
        if tran.card != current:
            if current is not None:
                account_total()
            current = tran.card
            if tran.card not in xref:
                raise DataError("cardxref.txt: card of a transaction not found")
        type_row = types.get(tran.type_cd)
        cat_row = cats.get((tran.type_cd, tran.cat_cd))
        if type_row is None:
            raise DataError("trantype.txt: type of a transaction not found")
        if cat_row is None:
            raise DataError("trancatg.txt: category of a transaction not found")
        if details == 0:
            headers()
        if counter % PAGE_SIZE == 0:
            page_total()
            headers()
        page += tran.amount
        account += tran.amount
        details += 1
        write(_detail_line(tran, xref[tran.card].account, type_row.desc, cat_row.desc))
    if details:
        page += tran.amount
    else:
        headers()
    page_total()
    out.append(_total_line("Grand Total", 11, grand))
    return out, details
