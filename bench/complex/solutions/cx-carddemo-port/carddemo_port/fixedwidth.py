"""Fixed-width record codec: layouts, zoned-decimal numbers, parse and format (M2, M3, T1, T7)."""
from decimal import Decimal

from carddemo_port.errors import DataError
from carddemo_port.records import Account, CatBal, DiscRow, Tran, XrefRow

_POS = "{ABCDEFGHI"
_NEG = "}JKLMNOPQR"
_DIGITS = "0123456789"
CENT = Decimal("0.01")

# Field kinds: "d" digits kept as text, "x" text, "s" signed money (2 decimals), "f" filler.
ACCOUNT = (("id", 11, "d"), ("status", 1, "x"), ("balance", 12, "s"), ("credit_limit", 12, "s"),
           ("cash_limit", 12, "s"), ("open_date", 10, "x"), ("expiry_date", 10, "x"),
           ("reissue_date", 10, "x"), ("cycle_credit", 12, "s"), ("cycle_debit", 12, "s"),
           ("zip", 10, "x"), ("group_id", 10, "x"), ("filler", 178, "f"))
XREF = (("card", 16, "x"), ("customer", 9, "d"), ("account", 11, "d"), ("filler", 14, "f"))
CATBAL = (("account", 11, "d"), ("type_cd", 2, "x"), ("cat_cd", 4, "d"), ("balance", 11, "s"),
          ("filler", 22, "f"))
DISCGRP = (("group", 10, "x"), ("type_cd", 2, "x"), ("cat_cd", 4, "d"), ("rate", 6, "s"),
           ("filler", 28, "f"))
TRAN = (("id", 16, "x"), ("type_cd", 2, "x"), ("cat_cd", 4, "d"), ("source", 10, "x"),
        ("desc", 100, "x"), ("amount", 11, "s"), ("merchant_id", 9, "d"),
        ("merchant_name", 50, "x"), ("merchant_city", 50, "x"), ("merchant_zip", 10, "x"),
        ("card", 16, "x"), ("orig_ts", 26, "x"), ("proc_ts", 26, "x"), ("filler", 20, "f"))


def decode_signed(text):
    """Decode a zoned decimal with 2 implied decimals. The last character may carry the sign."""
    if not text:
        raise DataError("empty number")
    body, last = text[:-1], text[-1]
    if last in _DIGITS:
        digit, sign = last, 1
    elif last in _POS:
        digit, sign = str(_POS.index(last)), 1
    elif last in _NEG:
        digit, sign = str(_NEG.index(last)), -1
    else:
        raise DataError("bad sign character")
    digits = body + digit
    if any(ch not in _DIGITS for ch in digits):
        raise DataError("non-digit in number")
    return Decimal(sign * int(digits)).scaleb(-2)


def encode_signed(value, width):
    """Encode a Decimal with at most 2 places as a zoned decimal of `width` characters."""
    if value != value.quantize(CENT):
        raise DataError("more than 2 decimal places")
    cents = int(abs(value) * 100)
    digits = str(cents)
    if len(digits) > width:
        raise DataError("number too wide")
    digits = digits.zfill(width)
    table = _NEG if value < 0 else _POS
    return digits[:-1] + table[int(digits[-1])]


def _parse(line, layout, what):
    total = sum(width for _, width, _ in layout)
    if len(line) > total:
        raise DataError("%s record too long" % what)
    line = line.ljust(total)
    values, pos = {}, 0
    for name, width, kind in layout:
        raw = line[pos:pos + width]
        pos += width
        if kind == "f":
            continue
        try:
            values[name] = _parse_field(raw, kind)
        except DataError as exc:
            raise DataError("field %s: %s" % (name, exc)) from None
    return values


def _parse_field(raw, kind):
    if kind == "s":
        return decode_signed(raw)
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in raw):
        raise DataError("control character")
    if kind == "d":
        if any(ch not in _DIGITS for ch in raw):
            raise DataError("non-digit")
        return raw
    return raw.rstrip()


def _format(obj, layout):
    parts = []
    for name, width, kind in layout:
        if kind == "f":
            parts.append(" " * width)
        elif kind == "s":
            parts.append(encode_signed(getattr(obj, name), width))
        else:
            parts.append(str(getattr(obj, name))[:width].ljust(width))
    return "".join(parts)


def parse_account(line):
    return Account(**_parse(line, ACCOUNT, "account"))


def parse_xref(line):
    return XrefRow(**_parse(line, XREF, "xref"))


def parse_catbal(line):
    return CatBal(**_parse(line, CATBAL, "catbal"))


def parse_discgrp(line):
    return DiscRow(**_parse(line, DISCGRP, "discgrp"))


def parse_tran(line):
    return Tran(**_parse(line, TRAN, "transaction"))


def format_account(rec):
    return _format(rec, ACCOUNT)


def format_xref(rec):
    return _format(rec, XREF)


def format_catbal(rec):
    return _format(rec, CATBAL)


def format_tran(rec):
    return _format(rec, TRAN)
