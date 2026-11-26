"""R5, T1 to T5: the read-only gate refuses every write, scope escape and runaway query."""
import os
import sqlite3
import unittest

from mes_analyst import sql_guard
from mes_analyst.sql_guard import QueryRefused
from tests.helpers import DbCase


class GuardTest(DbCase):
    def setUp(self):
        super().setUp()
        self.con = sql_guard.open_readonly(self.db)

    def tearDown(self):
        self.con.close()
        super().tearDown()

    def refused(self, sql):
        with self.assertRaises(QueryRefused) as cm:
            sql_guard.run_query(self.con, sql)
        return cm.exception.kind

    def test_select_works(self):
        res = sql_guard.run_query(self.con, "SELECT machine_id, line FROM machines ORDER BY machine_id")
        self.assertEqual(res["columns"], ["machine_id", "line"])
        self.assertEqual(res["rows"][0], ["M1", "A"])
        self.assertFalse(res["truncated"])

    def test_with_and_join_work(self):
        res = sql_guard.run_query(
            self.con,
            "WITH t AS (SELECT machine_id, SUM(minutes) AS m FROM downtime GROUP BY machine_id) "
            "SELECT t.machine_id, m.line, t.m FROM t JOIN machines m USING (machine_id)")
        self.assertEqual(len(res["rows"]), 6)

    def test_schema_read_works(self):
        res = sql_guard.run_query(self.con, "SELECT name FROM sqlite_master WHERE type='table'")
        self.assertEqual(len(res["rows"]), 6)

    def test_writes_refused(self):
        for sql in [
            "INSERT INTO machines VALUES ('M9', 'X', 'Z')",
            "UPDATE machines SET line = 'Z'",
            "DELETE FROM downtime",
            "DROP TABLE work_orders",
            "CREATE TABLE x (a)",
            "CREATE TEMP TABLE x (a)",
            "ALTER TABLE machines ADD COLUMN y",
            "REPLACE INTO machines VALUES ('M1', 'X', 'Z')",
            "WITH t AS (SELECT 1) DELETE FROM downtime",
            "  /* hi */ drop table defects",
            "VACUUM",
            "REINDEX",
            "BEGIN",
        ]:
            with self.subTest(sql=sql):
                self.assertEqual(self.refused(sql), "write")
        self.assertDbUnchanged()

    def test_pragmas_refused(self):
        for sql in ["PRAGMA query_only = OFF", "PRAGMA writable_schema = ON", "PRAGMA table_info(machines)"]:
            with self.subTest(sql=sql):
                self.assertEqual(self.refused(sql), "write")

    def test_authorizer_blocks_write_without_text_check(self):
        """The authorizer alone holds, even when the text check is skipped."""
        with self.assertRaises(sqlite3.DatabaseError):
            self.con.execute("DELETE FROM downtime")
        with self.assertRaises(sqlite3.DatabaseError):
            self.con.execute("PRAGMA query_only = OFF")
        self.assertDbUnchanged()

    def test_connection_is_ro_below_the_authorizer(self):
        """The file is opened with mode=ro, so even a connection with no authorizer cannot write."""
        raw = sqlite3.connect("file:%s?mode=ro" % self.db, uri=True)
        with self.assertRaises(sqlite3.OperationalError):
            raw.execute("DELETE FROM downtime")
        raw.close()

    def test_attach_refused(self):
        other = os.path.join(self.root, "other.db")
        self.assertEqual(self.refused("ATTACH DATABASE '%s' AS o" % other), "scope")
        self.assertFalse(os.path.exists(other))

    def test_bad_functions_refused(self):
        for sql in ["SELECT load_extension('x')", "SELECT readfile('/etc/passwd')"]:
            with self.subTest(sql=sql):
                self.assertIn(self.refused(sql), ("scope", "syntax"))

    def test_load_extension_function_is_denied_by_authorizer(self):
        with self.assertRaises(sqlite3.DatabaseError):
            self.con.execute("SELECT load_extension('x')")

    def test_multi_statement_refused(self):
        self.assertEqual(self.refused("SELECT 1; DROP TABLE machines"), "write")
        self.assertEqual(self.refused("SELECT 1; SELECT 2"), "syntax")
        self.assertDbUnchanged()

    def test_trailing_semicolon_ok(self):
        res = sql_guard.run_query(self.con, "SELECT 1;")
        self.assertEqual(res["rows"], [[1]])

    def test_empty_and_garbage_refused(self):
        self.assertEqual(self.refused(""), "syntax")
        self.assertEqual(self.refused("hello"), "syntax")
        self.assertEqual(self.refused("SELEC 1"), "syntax")

    def test_row_cap(self):
        res = sql_guard.run_query(self.con, "SELECT * FROM defects")
        self.assertEqual(len(res["rows"]), sql_guard.MAX_ROWS)
        self.assertTrue(res["truncated"])

    def test_cell_cap(self):
        res = sql_guard.run_query(self.con, "SELECT printf('%.2000c', 'x')")
        self.assertEqual(len(res["rows"][0][0]), sql_guard.MAX_CELL_CHARS)
        self.assertTrue(res["truncated"])

    def test_step_budget(self):
        sql = ("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) "
               "SELECT COUNT(*) FROM n")
        self.assertEqual(self.refused(sql), "limit")

    def test_recursive_cte_allowed_when_small(self):
        sql = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT COUNT(*) FROM n"
        self.assertEqual(sql_guard.run_query(self.con, sql)["rows"], [[5]])

    def test_connection_usable_after_refusal(self):
        self.refused("DROP TABLE machines")
        self.refused("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n")
        self.assertEqual(sql_guard.run_query(self.con, "SELECT COUNT(*) FROM machines")["rows"], [[6]])

    def test_open_missing_file_does_not_create(self):
        missing = os.path.join(self.root, "nope.db")
        with self.assertRaises(sqlite3.OperationalError):
            sql_guard.open_readonly(missing)
        self.assertFalse(os.path.exists(missing))


if __name__ == "__main__":
    unittest.main()
