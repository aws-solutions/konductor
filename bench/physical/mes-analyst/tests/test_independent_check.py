"""The raw-row derivation (independent_check.derive) agrees with the answer key on every brief and every seed."""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from independent_check import derive  # noqa: E402
from mes_analyst import fixture, key  # noqa: E402

SEEDS = (7, 11, 23, 42)


def _names(path):
    """Machine and product codes mapped to their names, read from the same database the key reads."""
    import sqlite3
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        machines = dict(con.execute("SELECT machine_id, name FROM machines").fetchall())
        products = dict(con.execute("SELECT product_id, name FROM products").fetchall())
    finally:
        con.close()
    return machines, products


def _to_names(answer, machines, products):
    """The raw-row answer with its codes replaced by names, so it compares with the key (which returns names)."""
    fixed = dict(answer)
    for field, table in (("top_downtime_machine", machines), ("cause_machine", machines),
                         ("worst_defect_product", products)):
        if field in fixed:
            fixed[field] = table.get(fixed[field], fixed[field])
    return fixed


class IndependentCheckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="mes-indep-")
        cls.dbs = {}
        for seed in SEEDS:
            path = os.path.join(cls.dir, "s%d.db" % seed)
            fixture.build(path, seed=seed)
            cls.dbs[seed] = path

    def test_raw_rows_and_key_agree_on_every_field_and_seed(self):
        for seed, path in self.dbs.items():
            machines, products = _names(path)
            mine = {b: _to_names(a, machines, products) for b, a in derive(path).items()}
            for brief_id, answer in mine.items():
                theirs = key.expected(brief_id, path)
                self.assertEqual(set(answer), set(theirs), "%s fields, seed %d" % (brief_id, seed))
                for field, value in answer.items():
                    other = theirs[field]
                    if isinstance(value, (int, float)):
                        self.assertAlmostEqual(float(value), float(other), places=9,
                                               msg="%s.%s seed %d" % (brief_id, field, seed))
                    else:
                        self.assertEqual(value, other, "%s.%s seed %d" % (brief_id, field, seed))


if __name__ == "__main__":
    unittest.main()
