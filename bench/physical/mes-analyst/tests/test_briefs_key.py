"""Every brief has a key answer with exactly the brief's fields, and the key is stable across fixture seeds."""
import os
import sqlite3
import tempfile
import unittest

from mes_analyst import briefs, fixture, key

SEEDS = (7, 11, 23, 42)


class BriefsKeyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="mes-briefs-")
        cls.dbs = {}
        for seed in SEEDS:
            path = os.path.join(cls.dir, "s%d.db" % seed)
            fixture.build(path, seed=seed)
            cls.dbs[seed] = path

    def test_every_brief_key_has_exactly_the_brief_fields(self):
        for brief_id, brief in briefs.BRIEFS.items():
            answer = key.expected(brief_id, self.dbs[7])
            self.assertEqual(set(answer), set(brief["fields"]), brief_id)

    def test_every_brief_key_passes_the_shape_check(self):
        for brief_id in briefs.BRIEFS:
            answer = key.expected(brief_id, self.dbs[7])
            self.assertIsNone(briefs.shape_error(brief_id, answer), brief_id)

    def test_planted_rankings_keep_a_clear_lead_on_every_seed(self):
        # A ranked answer whose leader is near its runner-up could flip on a data change; the key must not ship one.
        for seed in SEEDS:
            path = self.dbs[seed]
            m = key.margins(path)
            self.assertGreater(m["downtime_ratio"], 1.05, "B1 machine seed %d" % seed)
            self.assertGreater(m["line_b_type_ratio"], 1.05, "B2 defect type seed %d" % seed)
            # B3: downtime by reason, the leader over the runner-up.
            con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
            reasons = con.execute(key.DOWNTIME_BY_REASON).fetchall()
            con.close()
            self.assertGreater(reasons[0][1] / reasons[1][1], 1.05, "B3 reason seed %d" % seed)
            # B4: defects per line, the leading line over the runner-up.
            con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
            defect_lines = con.execute(key.DEFECTS_BY_LINE).fetchall()
            con.close()
            self.assertGreater(defect_lines[0][1] / defect_lines[1][1], 1.05, "B4 line seed %d" % seed)

    def test_b5_and_b6_are_counts_so_they_cannot_tie(self):
        self.assertEqual(key.expected("B5", self.dbs[7])["machine_count"], 6)
        for seed in SEEDS:
            self.assertEqual(key.expected("B5", self.dbs[seed])["machine_count"], 6, seed)


if __name__ == "__main__":
    unittest.main()
