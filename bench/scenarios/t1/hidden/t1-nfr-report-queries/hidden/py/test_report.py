import csv
import inspect
import json
import sqlite3
import subprocess
import sys
import tempfile
import tracemalloc
import unittest
from pathlib import Path

from timeouts import TimedCase
from reportjob.database import ReportDatabase
from reportjob.formatters import write_csv, write_json
from reportjob.report import ReportBuilder

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = (ROOT / "fixtures/schema.sql").read_text()
SAMPLE = (ROOT / "fixtures/sample.sql").read_text()


def sample_db():
    holder = tempfile.TemporaryDirectory()
    path = Path(holder.name) / "sample.sqlite"
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        conn.executescript(SAMPLE)
    return holder, path


def generated_db(customer_count=1, orders_per_customer=1):
    holder = tempfile.TemporaryDirectory()
    path = Path(holder.name) / "large.sqlite"
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        conn.executemany("INSERT INTO customers VALUES (?, ?, ?)",
                         [(i, f"Customer {i}", f"c{i}@example.com") for i in range(1, customer_count + 1)])
        orders = []
        order_id = 1
        for customer_id in range(1, customer_count + 1):
            for number in range(orders_per_customer):
                orders.append((order_id, customer_id, "2024-01-%02d" % (number % 28 + 1), number + 10))
                order_id += 1
        conn.executemany("INSERT INTO orders VALUES (?, ?, ?, ?)", orders)
    return holder, path, len(orders)


class OutputCompatibilityTests(TimedCase):
    def test_sample_csv_is_byte_for_byte_unchanged(self):
        holder, path = sample_db()
        self.addCleanup(holder.cleanup)
        output = Path(holder.name) / "report.csv"
        subprocess.run([sys.executable, "-m", "reportjob.cli", "--db", str(path), "--month", "2024-01", "--format", "csv", "--output", str(output)], cwd=ROOT, check=True)
        self.assertEqual(output.read_bytes(), (ROOT / "fixtures/expected/january.csv").read_bytes())

    def test_sample_json_is_byte_for_byte_unchanged(self):
        holder, path = sample_db()
        self.addCleanup(holder.cleanup)
        output = Path(holder.name) / "report.json"
        subprocess.run([sys.executable, "-m", "reportjob.cli", "--db", str(path), "--month", "2024-01", "--format", "json", "--output", str(output)], cwd=ROOT, check=True)
        self.assertEqual(output.read_bytes(), (ROOT / "fixtures/expected/january.json").read_bytes())


class QueryBudgetTests(TimedCase):
    def _traced_rows(self, customers):
        holder, path, _ = generated_db(customers)
        self.addCleanup(holder.cleanup)
        conn = sqlite3.connect(path)
        self.addCleanup(conn.close)
        statements = []
        conn.set_trace_callback(statements.append)
        rows = list(ReportBuilder(ReportDatabase(path, connection=conn)).iter_rows("2024-01"))
        return rows, statements

    def test_small_report_uses_at_most_three_sql_statements(self):
        rows, statements = self._traced_rows(4)
        self.assertEqual(len(rows), 4)
        self.assertLessEqual(len(statements), 3)

    def test_statement_ceiling_does_not_grow_with_customers(self):
        rows, statements = self._traced_rows(160)
        self.assertEqual(len(rows), 160)
        self.assertLessEqual(len(statements), 3)

    def test_more_customers_do_not_add_trace_events(self):
        _, few = self._traced_rows(3)
        _, many = self._traced_rows(60)
        self.assertLessEqual(len(many), len(few) + 1)

    def test_builder_returns_a_lazy_iterator(self):
        holder, path, _ = generated_db(2)
        self.addCleanup(holder.cleanup)
        with sqlite3.connect(path) as conn:
            result = ReportBuilder(ReportDatabase(path, connection=conn)).iter_rows("2024-01")
            self.assertTrue(inspect.isgenerator(result))


class StreamingOutputTests(TimedCase):
    def _render(self, kind):
        holder, path, total = generated_db(1, 12000)
        self.addCleanup(holder.cleanup)
        output = Path(holder.name) / ("report." + kind)
        with sqlite3.connect(path) as conn:
            rows = ReportBuilder(ReportDatabase(path, connection=conn)).iter_rows("2024-01")
            tracemalloc.start()
            if kind == "csv":
                write_csv(rows, output)
            else:
                write_json(rows, output)
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
        return output, total, peak

    def test_csv_peak_memory_stays_below_eight_megabytes(self):
        output, total, peak = self._render("csv")
        self.assertLess(peak, 8 * 1024 * 1024)
        with output.open(newline="") as stream:
            self.assertEqual(sum(1 for _ in csv.DictReader(stream)), total)

    def test_json_peak_memory_stays_below_eight_megabytes(self):
        output, total, peak = self._render("json")
        self.assertLess(peak, 8 * 1024 * 1024)
        self.assertEqual(len(json.loads(output.read_text())), total)

    def test_csv_contains_every_large_report_row(self):
        output, total, _ = self._render("csv")
        with output.open(newline="") as stream:
            self.assertEqual(sum(1 for _ in csv.DictReader(stream)), total)

    def test_json_is_one_complete_array(self):
        output, total, _ = self._render("json")
        document = json.loads(output.read_text())
        self.assertEqual(len(document), total)
        self.assertEqual({row["order_id"] for row in document}, set(range(1, total + 1)))


class InterfaceTests(TimedCase):
    def test_rows_have_the_documented_schema(self):
        holder, path = sample_db()
        self.addCleanup(holder.cleanup)
        with sqlite3.connect(path) as conn:
            rows = list(ReportBuilder(ReportDatabase(path, connection=conn)).iter_rows("2024-01"))
        self.assertEqual(list(rows[0]), ["customer_id", "customer_name", "email", "order_id", "order_date", "total_cents"])

    def test_unknown_month_writes_an_empty_csv(self):
        holder, path = sample_db()
        self.addCleanup(holder.cleanup)
        output = Path(holder.name) / "empty.csv"
        with sqlite3.connect(path) as conn:
            write_csv(ReportBuilder(ReportDatabase(path, connection=conn)).iter_rows("2025-01"), output)
        self.assertEqual(output.read_text(), "customer_id,customer_name,email,order_id,order_date,total_cents\n")

    def test_cli_rejects_a_malformed_month(self):
        holder, path = sample_db()
        self.addCleanup(holder.cleanup)
        output = Path(holder.name) / "bad.csv"
        result = subprocess.run([sys.executable, "-m", "reportjob.cli", "--db", str(path), "--month", "January", "--format", "csv", "--output", str(output)], cwd=ROOT, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)

    def test_json_formatter_accepts_an_iterator_without_materializing_api(self):
        holder, path = sample_db()
        self.addCleanup(holder.cleanup)
        output = Path(holder.name) / "iter.json"
        with sqlite3.connect(path) as conn:
            write_json((row for row in ReportBuilder(ReportDatabase(path, connection=conn)).iter_rows("2024-01")), output)
        self.assertEqual(len(json.loads(output.read_text())), 4)
