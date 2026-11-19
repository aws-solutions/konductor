import contextlib
import io
import unittest
from datetime import datetime

from ledger.cli import main


class CliTests(unittest.TestCase):
    def test_empty_account_statement_can_be_printed(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = main([
                "cash",
                "--start", "2024-01-01T00:00:00",
                "--end", "2024-01-31T23:59:59",
            ])
        self.assertEqual(result, 0)
        self.assertIn("Account: cash", output.getvalue())
