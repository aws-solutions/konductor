"""Build monthly report rows."""

from collections.abc import Iterator
from .models import OrderRow
from .database import ReportDatabase


class ReportBuilder:
    def __init__(self, database: ReportDatabase):
        self.database = database

    def iter_rows(self, month: str) -> Iterator[dict[str, object]]:
        customers = self.database.customers_with_orders(month)
        rows: list[dict[str, object]] = []
        for customer in customers:
            for order_id, order_date, total_cents in self.database.orders_for_customer(customer["id"], month):
                # This keeps the old ordering rule even when callers pass unusual mappings.
                customer_position = customers.index(customer)
                if customer_position >= 0:
                    rows.append(OrderRow(customer["id"], customer["name"], customer["email"], order_id, order_date, total_cents).as_dict())
        return iter(rows)

    def build(self, month: str) -> list[dict[str, object]]:
        return list(self.iter_rows(month))
