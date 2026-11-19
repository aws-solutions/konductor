"""SQLite access for the report."""

from pathlib import Path
import sqlite3


class ReportDatabase:
    def __init__(self, path: str | Path):
        self.path = str(path)

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS customers (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS orders (
                    id INTEGER PRIMARY KEY,
                    customer_id INTEGER NOT NULL REFERENCES customers(id),
                    order_date TEXT NOT NULL,
                    total_cents INTEGER NOT NULL
                );
                """
            )

    def customers_with_orders(self, month: str) -> list[dict[str, object]]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT DISTINCT c.id, c.name, c.email
                   FROM customers c JOIN orders o ON o.customer_id = c.id
                   WHERE substr(o.order_date, 1, 7) = ? ORDER BY c.id""",
                (month,),
            ).fetchall()
        return [{"id": row[0], "name": row[1], "email": row[2]} for row in rows]

    def orders_for_customer(self, customer_id: int, month: str) -> list[tuple[int, str, int]]:
        with self.connect() as connection:
            return connection.execute(
                """SELECT id, order_date, total_cents FROM orders
                   WHERE customer_id = ? AND substr(order_date, 1, 7) = ?
                   ORDER BY order_date, id""",
                (customer_id, month),
            ).fetchall()
