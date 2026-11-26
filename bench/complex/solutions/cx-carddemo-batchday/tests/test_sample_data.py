"""Post and interest on the sample files in data/. Checks rules that must hold for any input.

Exact outputs are not pinned here: the hand-worked cases in the other test files do that.
"""
import shutil
import tempfile
import unittest
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from carddemo_port import fixedwidth as fw
from carddemo_port import jobs

DATA = Path(__file__).resolve().parent.parent / "data"
NOW = datetime(2026, 11, 25, 12, 0, 0)


def lines(path):
    return [ln for ln in Path(path).read_text().splitlines() if ln.strip()]


class SampleDataTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="carddemo-sample-")
        self.addCleanup(self._tmp.cleanup)
        self.out = Path(self._tmp.name) / "out"

    def test_post_conserves_money_and_counts(self):
        summary = jobs.run_post(DATA, self.out, NOW)
        count = len(lines(DATA / "dailytran.txt"))
        self.assertEqual(summary["processed"], count)
        self.assertEqual(summary["posted"] + summary["rejected"], count)
        self.assertGreater(summary["posted"], 0)

        posted = [fw.parse_tran(ln) for ln in lines(self.out / "transact.txt")]
        self.assertEqual(len(posted), summary["posted"])
        self.assertEqual(len(lines(self.out / "dalyrejs.txt")), summary["rejected"])
        total = sum((t.amount for t in posted), Decimal("0.00"))

        def balances(path):
            return sum((fw.parse_account(ln).balance for ln in lines(path)), Decimal("0.00"))

        self.assertEqual(balances(self.out / "acctdata.txt") - balances(DATA / "acctdata.txt"), total)

        def cat_total(path):
            return sum((fw.parse_catbal(ln).balance for ln in lines(path)), Decimal("0.00"))

        self.assertEqual(cat_total(self.out / "tcatbal.txt") - cat_total(DATA / "tcatbal.txt"), total)

    def test_interest_after_posting_charges_every_account_and_resets_cycles(self):
        jobs.run_post(DATA, self.out, NOW)
        month_end = Path(self._tmp.name) / "month-end"
        month_end.mkdir()
        for name in ("acctdata.txt", "tcatbal.txt"):
            shutil.copy(self.out / name, month_end / name)
        for name in ("cardxref.txt", "discgrp.txt"):
            shutil.copy(DATA / name, month_end / name)
        out2 = Path(self._tmp.name) / "out2"
        summary = jobs.run_interest(month_end, out2, "2026-11-25", NOW)

        trans = [fw.parse_tran(ln) for ln in lines(out2 / "transact.txt")]
        self.assertEqual(len(trans), summary["interest_transactions"])
        self.assertGreater(len(trans), 0)
        self.assertTrue(all(t.amount > 0 for t in trans))
        self.assertEqual([t.id for t in trans],
                         ["2026-11-25%06d" % n for n in range(1, len(trans) + 1)])
        accts = [fw.parse_account(ln) for ln in lines(out2 / "acctdata.txt")]
        self.assertTrue(all(a.cycle_credit == 0 and a.cycle_debit == 0 for a in accts))
        before = sum((fw.parse_account(ln).balance for ln in lines(self.out / "acctdata.txt")), Decimal("0.00"))
        after = sum((a.balance for a in accts), Decimal("0.00"))
        self.assertEqual(after - before, sum((t.amount for t in trans), Decimal("0.00")))


if __name__ == "__main__":
    unittest.main()
