"""Numeric-edited fields of the report and statement lines (REQUIREMENTS R5).

Each function returns a fixed-width string for a Decimal with 2 places. The integer part is right-aligned and
blank-filled on the left, but its last digit always prints, so zero is `0.00`, never blanks.
"""
from carddemo_port.errors import DataError


def _parts(value, int_digits):
    whole, frac = divmod(int(abs(value) * 100), 100)
    if whole >= 10 ** int_digits:
        raise DataError("amount too wide for its report field")
    return whole, "%02d" % frac


def detail_amount(value):
    """PIC -ZZZ,ZZZ,ZZZ.ZZ (15 characters): a leading `-` for a negative, else a blank."""
    whole, frac = _parts(value, 9)
    return ("-" if value < 0 else " ") + "{:,}".format(whole).rjust(11) + "." + frac


def total_amount(value):
    """PIC +ZZZ,ZZZ,ZZZ.ZZ (15 characters): a leading `+`, or `-` for a negative."""
    whole, frac = _parts(value, 9)
    return ("-" if value < 0 else "+") + "{:,}".format(whole).rjust(11) + "." + frac


def statement_amount(value):
    """PIC Z(9).99- (13 characters): a trailing `-` for a negative, else a blank."""
    whole, frac = _parts(value, 9)
    return str(whole).rjust(9) + "." + frac + ("-" if value < 0 else " ")


def balance_amount(value):
    """PIC 9(9).99- (13 characters). A balance too wide for it is refused (the reading before the 2026-11-26 R5 change)."""
    whole, frac = _parts(value, 9)
    return str(whole).zfill(9) + "." + frac + ("-" if value < 0 else " ")
