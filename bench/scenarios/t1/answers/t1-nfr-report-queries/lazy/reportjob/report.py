"""Build monthly report rows."""

from collections.abc import Iterator
from .models import OrderRow
from .database import ReportDatabase


class ReportBuilder:
    def __init__(self, database: ReportDatabase):
        self.database = database

    def iter_rows(self, month: str) -> Iterator[dict[str, object]]:
        customers = self.database.customers_with_orders(month)
        for customer in customers:
            for order_id, order_date, total_cents in self.database.orders_for_customer(customer["id"], month):
                yield OrderRow(customer["id"], customer["name"], customer["email"], order_id, order_date, total_cents).as_dict()

    def build(self, month: str) -> list[dict[str, object]]:
        return list(self.iter_rows(month))
