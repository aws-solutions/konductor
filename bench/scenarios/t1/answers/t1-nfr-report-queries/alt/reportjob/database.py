"""SQLite access for the report."""

from pathlib import Path
import sqlite3
from collections.abc import Iterator


class ReportDatabase:
    def __init__(self, path: str | Path | None = None, *, connection: sqlite3.Connection | None = None):
        if connection is not None:
            self._connection = connection
            self._owns_connection = False
            self.path = "<external>"
        elif path is not None:
            self._connection = None
            self._owns_connection = True
            self.path = str(path)
        else:
            raise ValueError("Either path or connection must be provided")

    def _get_connection(self) -> sqlite3.Connection:
        if self._connection is not None:
            return self._connection
        return sqlite3.connect(self.path)

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
        with self._get_connection() if self._owns_connection else self._get_connection() as connection:
            rows = connection.execute(
                """SELECT DISTINCT c.id, c.name, c.email
                   FROM customers c JOIN orders o ON o.customer_id = c.id
                   WHERE substr(o.order_date, 1, 7) = ? ORDER BY c.id""",
                (month,),
            ).fetchall()
        return [{"id": row[0], "name": row[1], "email": row[2]} for row in rows]

    def orders_for_customer(self, customer_id: int, month: str) -> list[tuple[int, str, int]]:
        with self._get_connection() if self._owns_connection else self._get_connection() as connection:
            return connection.execute(
                """SELECT id, order_date, total_cents FROM orders
                   WHERE customer_id = ? AND substr(order_date, 1, 7) = ?
                   ORDER BY order_date, id""",
                (customer_id, month),
            ).fetchall()

    def iter_report_rows(self, month: str) -> Iterator[tuple[int, str, str, int, str, int]]:
        """Yield report rows as (customer_id, customer_name, email, order_id, order_date, total_cents) tuples.

        Uses a single SQL query for memory efficiency, ordering by customer_id, order_date, order_id.
        """
        conn = self._get_connection()
        try:
            cursor = conn.execute(
                """SELECT c.id, c.name, c.email, o.id, o.order_date, o.total_cents
                   FROM customers c
                   JOIN orders o ON o.customer_id = c.id
                   WHERE substr(o.order_date, 1, 7) = ?
                   ORDER BY c.id, o.order_date, o.id""",
                (month,),
            )
            for row in cursor:
                yield row
        finally:
            if self._owns_connection:
                conn.close()
