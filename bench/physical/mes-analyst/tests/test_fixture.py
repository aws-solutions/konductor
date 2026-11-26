"""R1, R2, R3, T11: the fixture is deterministic, holds its planted patterns, and the key agrees."""
import os
import sqlite3
import tempfile
import unittest

from mes_analyst import fixture, key
from tests.helpers import DbCase


class FixtureTest(DbCase):
    def test_same_seed_same_content(self):
        with tempfile.TemporaryDirectory(prefix="mes-test-") as d:
            other = fixture.build(os.path.join(d, "mes.db"), seed=7)
            self.assertEqual(fixture.content_hash(other), fixture.content_hash(self.db))

    def test_other_seed_other_content(self):
        with tempfile.TemporaryDirectory(prefix="mes-test-") as d:
            other = fixture.build(os.path.join(d, "mes.db"), seed=8)
            self.assertNotEqual(fixture.content_hash(other), fixture.content_hash(self.db))

    def test_build_refuses_to_overwrite(self):
        with self.assertRaises(FileExistsError):
            fixture.build(self.db, seed=7)

    def test_tables(self):
        con = sqlite3.connect(self.db)
        names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        con.close()
        self.assertEqual(names, {"products", "machines", "work_orders", "downtime", "quality_checks", "defects"})

    def test_defect_rows_match_quality_counts(self):
        con = sqlite3.connect(self.db)
        per_check = con.execute(
            "SELECT q.qc_id, q.defect_count, (SELECT COUNT(*) FROM defects d WHERE d.qc_id = q.qc_id)"
            " FROM quality_checks q").fetchall()
        con.close()
        self.assertTrue(per_check)
        for qc_id, count, rows in per_check:
            self.assertEqual(count, rows, qc_id)

    def test_injection_notes_planted(self):
        con = sqlite3.connect(self.db)
        n = con.execute("SELECT COUNT(*) FROM defects WHERE note LIKE '%DROP TABLE%'").fetchone()[0]
        con.close()
        self.assertGreaterEqual(n, 1)

    def test_planted_patterns_b1(self):
        # The key returns names; the planted values are codes. Map the codes to names from the same database.
        import sqlite3
        con = sqlite3.connect("file:%s?mode=ro" % self.db, uri=True)
        try:
            machines = dict(con.execute("SELECT machine_id, name FROM machines").fetchall())
            products = dict(con.execute("SELECT product_id, name FROM products").fetchall())
        finally:
            con.close()
        exp = key.expected("B1", self.db)
        self.assertEqual(exp["top_downtime_machine"], machines[fixture.PLANTED["downtime_machine"]])
        self.assertEqual(exp["worst_defect_product"], products[fixture.PLANTED["defect_product"]])
        self.assertEqual(exp["cause_machine"], machines[fixture.PLANTED["downtime_machine"]])

    def test_planted_patterns_b2(self):
        exp = key.expected("B2", self.db)
        self.assertEqual(exp["top_defect_type"], fixture.PLANTED["line_b_defect_type"])

    def test_key_cross_check_b1(self):
        """The key's total units equals the sum the generator wrote, computed a second way."""
        exp = key.expected("B1", self.db)
        con = sqlite3.connect(self.db)
        rows = con.execute("SELECT qty_produced FROM work_orders").fetchall()
        con.close()
        self.assertEqual(exp["total_units_produced"], sum(r[0] for r in rows))

    def test_planted_margins_are_clear(self):
        """The planted leaders win by a clear margin, so a small data change cannot flip the key."""
        m = key.margins(self.db)
        self.assertGreater(m["downtime_ratio"], 2.0)
        self.assertGreater(m["defect_rate_ratio"], 1.5)
        self.assertGreater(m["cause_rate_ratio"], 2.0)
        self.assertGreater(m["line_b_type_ratio"], 1.5)

    def test_unknown_brief(self):
        with self.assertRaises(KeyError):
            key.expected("B9", self.db)


if __name__ == "__main__":
    unittest.main()
