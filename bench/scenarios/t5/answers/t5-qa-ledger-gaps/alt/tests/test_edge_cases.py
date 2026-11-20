# Changes for this request; see the commit message for the reasoning.
import io
import unittest
from datetime import datetime
from decimal import Decimal

from ledger import Ledger, LedgerError, accrue_interest, apply_monthly_fee, calculate_interest
from ledger.export import write_csv


class LedgerEdgeCaseTests(unittest.TestCase):
    def test_interest_uses_half_up_rounding(self):
        self.assertEqual(str(calculate_interest(Decimal("100"), "0.01005", 365)), "1.01")

    def test_interest_keeps_two_decimal_places(self):
        self.assertEqual(str(calculate_interest(Decimal("10"), "0.12", 365)), "1.20")

    def test_negative_fee_is_rejected(self):
        ledger = Ledger()
        ledger.create_account("cash")
        with self.assertRaises(ValueError):
            apply_monthly_fee(ledger, "cash", "-2.00", "bad-fee", datetime(2024, 1, 1))
        self.assertNotIn("bad-fee", [tx.transaction_id for tx in ledger.transactions])

    def test_statement_includes_both_datetime_endpoints(self):
        ledger = Ledger()
        ledger.create_account("cash")
        ledger.create_account("bank", "1000.00")
        start = datetime(2024, 2, 1, 0, 0, 0)
        end = datetime(2024, 2, 29, 23, 59, 59)
        ledger.post("at-start", "bank", "cash", "5.00", start)
        ledger.post("at-end", "bank", "cash", "7.00", end)
        ledger.post("after", "bank", "cash", "11.00", datetime(2024, 3, 1))
        statement = ledger.statement("cash", start, end)
        self.assertEqual([tx.transaction_id for tx in statement.transactions], ["at-start", "at-end"])
        self.assertEqual(statement.opening_balance, Decimal("0.00"))
        self.assertEqual(statement.closing_balance, Decimal("12.00"))

    def test_overdraft_at_limit_is_allowed(self):
        ledger = Ledger()
        ledger.create_account("checking", "10.00")
        ledger.create_account("bank", "100.00")
        ledger.post("limit", "checking", "bank", "10.00", datetime(2024, 1, 1))
        self.assertEqual(ledger.balance("checking"), Decimal("-10.00"))

    def test_reposting_a_transaction_id_is_idempotent(self):
        ledger = Ledger()
        ledger.create_account("cash")
        ledger.create_account("bank", "100.00")
        first = ledger.post("same", "bank", "cash", "4.00", datetime(2024, 1, 1))
        second = ledger.post("same", "bank", "cash", "9.00", datetime(2024, 1, 2))
        self.assertIs(second, first)
        self.assertEqual(len(ledger.transactions), 1)
        self.assertEqual(ledger.balance("cash"), Decimal("4.00"))

    def test_reversing_an_already_reversed_transaction_fails(self):
        ledger = Ledger()
        ledger.create_account("source", "100.00")
        ledger.create_account("target", "100.00")
        ledger.post("original", "source", "target", "4.00", datetime(2024, 1, 1))
        ledger.reverse("original", "undo-1", datetime(2024, 1, 2))
        with self.assertRaisesRegex(LedgerError, "already reversed"):
            ledger.reverse("original", "undo-2", datetime(2024, 1, 3))
        self.assertEqual(len(ledger.transactions), 2)

    def test_csv_preserves_debit_and_credit_columns(self):
        ledger = Ledger()
        ledger.create_account("cash")
        ledger.create_account("bank", "100.00")
        ledger.post("deposit", "bank", "cash", "4.00", datetime(2024, 1, 1))
        statement = ledger.statement("cash", datetime(2024, 1, 1), datetime(2024, 1, 2))
        output = io.StringIO()
        write_csv(statement, output)
        row = output.getvalue().splitlines()[1].split(",")
        self.assertEqual(row[2:4], ["bank", "cash"])


if __name__ == "__main__":
    unittest.main()
