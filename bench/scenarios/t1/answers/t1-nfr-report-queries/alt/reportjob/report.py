"""Build monthly report rows."""

from collections.abc import Iterator
from .models import OrderRow
from .database import ReportDatabase


class ReportBuilder:
    def __init__(self, database: ReportDatabase):
        self.database = database

    def iter_rows(self, month: str) -> Iterator[dict[str, object]]:
        for customer_id, customer_name, email, order_id, order_date, total_cents in self.database.iter_report_rows(month):
            yield OrderRow(customer_id, customer_name, email, order_id, order_date, total_cents).as_dict()

    def build(self, month: str) -> list[dict[str, object]]:
        return list(self.iter_rows(month))
