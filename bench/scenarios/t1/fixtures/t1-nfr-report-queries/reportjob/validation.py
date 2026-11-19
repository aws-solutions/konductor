"""Input checks shared by integrations."""

import re

_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def validate_month(month: str) -> str:
    if not _MONTH.fullmatch(month):
        raise ValueError("month must have YYYY-MM form")
    return month
