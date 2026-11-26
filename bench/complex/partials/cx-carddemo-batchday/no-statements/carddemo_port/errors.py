"""Error types. Messages name files, lines and fields, never record values."""


class DataError(Exception):
    """An input file or record is malformed, missing, too large, or refers to a missing record."""


class ConfigError(Exception):
    """A rule table is incomplete, for example no interest rate and no DEFAULT rate."""
