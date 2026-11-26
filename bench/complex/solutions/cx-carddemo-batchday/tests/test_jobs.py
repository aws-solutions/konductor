"""T1, T4-T6, T11, P13: file edges, atomic output, caps, CLI. Uses temp dirs only."""
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from carddemo_port import cli, jobs
from carddemo_port import fixedwidth as fw
from carddemo_port.errors import DataError
from tests.helpers import NOW, D, account, catbal, tran, xref


def write_inputs(dirpath, trans=(), accounts=(), xrefs=(), catbals=(), rates=()):
    """Write the five input files from record objects (rates: DiscRow list as text lines)."""
    files = {
        "dailytran.txt": [fw.format_tran(t) for t in trans],
        "acctdata.txt": [fw.format_account(a) for a in accounts],
        "cardxref.txt": [fw.format_xref(x) for x in xrefs],
        "tcatbal.txt": [fw.format_catbal(c) for c in catbals],
        "discgrp.txt": list(rates),
    }
    for name, lines in files.items():
        Path(dirpath, name).write_text("".join(line + "\n" for line in lines), encoding="ascii")


class JobsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="carddemo-test-")
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.inp = self.root / "in"
        self.inp.mkdir()
        self.out = self.root / "out"

    def post_inputs(self, trans):
        write_inputs(self.inp, trans=trans, accounts=[account()], xrefs=[xref()])

    def test_post_writes_all_outputs_and_summary(self):
        self.post_inputs([tran(tran_id="0000000000000001", amount="50.47"),
                          tran(tran_id="0000000000000002", card="9999999999999999")])
        summary = jobs.run_post(self.inp, self.out, NOW)
        self.assertEqual(summary, {"processed": 2, "posted": 1, "rejected": 1})
        self.assertEqual(sorted(p.name for p in self.out.iterdir()),
                         ["acctdata.txt", "dalyrejs.txt", "summary.json", "tcatbal.txt", "transact.txt"])
        self.assertEqual(json.loads((self.out / "summary.json").read_text()), summary)
        acct = fw.parse_account((self.out / "acctdata.txt").read_text().splitlines()[0])
        self.assertEqual(acct.balance, D("150.47"))
        reject = (self.out / "dalyrejs.txt").read_text().splitlines()[0]
        self.assertEqual(len(reject), 350 + 4 + 76)
        self.assertEqual(reject[350:354], "0100")
        self.assertTrue(reject[354:].startswith("INVALID CARD NUMBER FOUND"))

    def test_interest_job_reads_post_output(self):
        self.post_inputs([tran(amount="1000.00")])
        jobs.run_post(self.inp, self.out, NOW)
        rate = "DEFAULT   010001" + fw.encode_signed(D("18.00"), 6) + " " * 28
        second_in = self.root / "in2"
        second_in.mkdir()
        write_inputs(second_in, xrefs=[xref()], rates=[rate])
        for name in ("acctdata.txt", "tcatbal.txt"):
            (second_in / name).write_text((self.out / name).read_text())
        out2 = self.root / "out2"
        summary = jobs.run_interest(second_in, out2, "2026-11-25", NOW)
        self.assertEqual(summary["interest_transactions"], 1)
        acct = fw.parse_account((out2 / "acctdata.txt").read_text().splitlines()[0])
        self.assertEqual(acct.balance, D("1115.00"))      # 100 + 1000 + 1000*18/1200
        self.assertEqual(acct.cycle_credit, D("0.00"))

    def test_bad_input_stops_the_run_and_writes_nothing(self):
        self.post_inputs([tran()])
        (self.inp / "cardxref.txt").write_text("not a record\n")
        with self.assertRaises(DataError) as ctx:
            jobs.run_post(self.inp, self.out, NOW)
        self.assertIn("cardxref.txt", str(ctx.exception))
        self.assertIn("line 1", str(ctx.exception))
        self.assertFalse(self.out.exists())
        self.assertEqual([p.name for p in self.root.iterdir()], ["in"])   # no temp dir left

    def test_existing_non_empty_output_dir_is_refused(self):
        self.post_inputs([tran()])
        self.out.mkdir()
        (self.out / "keep.txt").write_text("mine")
        with self.assertRaises(DataError):
            jobs.run_post(self.inp, self.out, NOW)
        self.assertEqual((self.out / "keep.txt").read_text(), "mine")

    def test_empty_existing_output_dir_is_allowed(self):
        self.post_inputs([tran()])
        self.out.mkdir()
        jobs.run_post(self.inp, self.out, NOW)
        self.assertTrue((self.out / "summary.json").exists())

    def test_symlinked_input_is_refused(self):
        self.post_inputs([tran()])
        real = self.root / "real.txt"
        real.write_text("")
        (self.inp / "dailytran.txt").unlink()
        os.symlink(real, self.inp / "dailytran.txt")
        with self.assertRaises(DataError):
            jobs.run_post(self.inp, self.out, NOW)

    def test_missing_input_file_is_an_error(self):
        self.post_inputs([tran()])
        (self.inp / "acctdata.txt").unlink()
        with self.assertRaises(DataError):
            jobs.run_post(self.inp, self.out, NOW)

    def test_file_and_line_caps(self):
        self.post_inputs([tran()])
        with mock.patch.object(jobs, "MAX_FILE_BYTES", 100), self.assertRaises(DataError):
            jobs.run_post(self.inp, self.out, NOW)
        with mock.patch.object(jobs, "MAX_LINE_CHARS", 10), self.assertRaises(DataError):
            jobs.run_post(self.inp, self.out, NOW)
        self.assertFalse(self.out.exists())

    def test_cli_prints_counts_only_and_exits_4_on_rejects(self):
        self.post_inputs([tran(card="4999999999999999", amount="12.34")])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = cli.main(["post", "--in", str(self.inp), "--out", str(self.out)])
        self.assertEqual(code, 4)
        text = buf.getvalue()
        self.assertIn("rejected: 1", text)
        for secret in ("4999999999999999", "12.34", "4000000000000001"):
            self.assertNotIn(secret, text)

    def test_cli_exit_0_when_nothing_rejected(self):
        self.post_inputs([tran()])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(["post", "--in", str(self.inp), "--out", str(self.out)]), 0)

    def test_cli_bad_input_exits_2_and_names_no_card_numbers(self):
        self.post_inputs([tran()])
        (self.inp / "cardxref.txt").write_text("4000000000000001 junk\n")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = cli.main(["post", "--in", str(self.inp), "--out", str(self.out)])
        self.assertEqual(code, 2)
        self.assertNotIn("4000000000000001", err.getvalue())

    def test_cli_interest_requires_a_valid_run_date(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            cli.main(["interest", "--in", str(self.inp), "--out", str(self.out), "--run-date", "11/25/2026"])


if __name__ == "__main__":
    unittest.main()
