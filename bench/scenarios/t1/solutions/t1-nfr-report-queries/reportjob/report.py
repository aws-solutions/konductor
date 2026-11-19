"""Build monthly report rows."""

from collections.abc import Iterator
from .database import ReportDatabase


class ReportBuilder:
    def __init__(self, database: ReportDatabase):
        self.database = database

    def iter_rows(self, month: str) -> Iterator[dict[str, object]]:
        return self.database.iter_monthly_rows(month)

    def build(self, month: str) -> list[dict[str, object]]:
        return list(self.iter_rows(month))
