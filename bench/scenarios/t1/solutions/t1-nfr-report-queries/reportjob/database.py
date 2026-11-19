"""SQLite access for the report."""

from pathlib import Path
import sqlite3
from collections.abc import Iterator


class ReportDatabase:
    def __init__(self, path: str | Path, connection: sqlite3.Connection | None = None):
        self.path = str(path)
        self._connection = connection

    def connect(self) -> sqlite3.Connection:
        return self._connection if self._connection is not None else sqlite3.connect(self.path)

    def initialize(self) -> None:
        connection = self.connect()
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
        if self._connection is None:
            connection.close()

    def customers_with_orders(self, month: str) -> list[dict[str, object]]:
        connection = self.connect()
        try:
            rows = connection.execute(
                """SELECT DISTINCT c.id, c.name, c.email
                   FROM customers c JOIN orders o ON o.customer_id = c.id
                   WHERE substr(o.order_date, 1, 7) = ? ORDER BY c.id""",
                (month,),
            ).fetchall()
        finally:
            if self._connection is None:
                connection.close()
        return [{"id": row[0], "name": row[1], "email": row[2]} for row in rows]

    def orders_for_customer(self, customer_id: int, month: str) -> list[tuple[int, str, int]]:
        connection = self.connect()
        try:
            return connection.execute(
                """SELECT id, order_date, total_cents FROM orders
                   WHERE customer_id = ? AND substr(order_date, 1, 7) = ?
                   ORDER BY order_date, id""",
                (customer_id, month),
            ).fetchall()
        finally:
            if self._connection is None:
                connection.close()

    def iter_monthly_rows(self, month: str) -> Iterator[dict[str, object]]:
        """Yield joined report rows while SQLite advances its result cursor."""
        connection = self.connect()
        cursor = connection.execute(
            """SELECT c.id, c.name, c.email, o.id, o.order_date, o.total_cents
               FROM customers c JOIN orders o ON o.customer_id = c.id
               WHERE substr(o.order_date, 1, 7) = ?
               ORDER BY c.id, o.order_date, o.id""",
            (month,),
        )
        try:
            for customer_id, name, email, order_id, order_date, total_cents in cursor:
                yield {
                    "customer_id": customer_id,
                    "customer_name": name,
                    "email": email,
                    "order_id": order_id,
                    "order_date": order_date,
                    "total_cents": total_cents,
                }
        finally:
            cursor.close()
            if self._connection is None:
                connection.close()
