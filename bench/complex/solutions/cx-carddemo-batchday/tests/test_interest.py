"""I1-I9, T2, T9: interest rules, checked against hand-worked numbers."""
import unittest

from carddemo_port.errors import ConfigError, DataError
from carddemo_port.interest import compute_interest
from tests.helpers import NOW, NOW_TS, D, account, catbal, stores, xref

RUN_DATE = "2026-11-25"
A1, A2 = "00000000001", "00000000002"
CARD1, CARD2 = "4000000000000001", "4000000000000002"


def run(accounts, catbals, rates, xrefs=None):
    xrefs = xrefs if xrefs is not None else [xref(CARD1, A1), xref(CARD2, A2)]
    accts, xr, cats = stores(accounts, xrefs, catbals)
    return compute_interest(cats, rates, accts, xr, RUN_DATE, NOW)


class InterestTest(unittest.TestCase):
    def two_accounts(self):
        return [account(A1, balance="100.00", group="A", cyc_credit="5.00", cyc_debit="-1.00"),
                account(A2, balance="50.00", group="B", cyc_credit="2.00")]

    def test_worked_example_with_default_group_fallback(self):
        cats = [catbal(A1, "01", "0001", "1000.00"), catbal(A1, "01", "0002", "500.00"),
                catbal(A2, "01", "0001", "200.00")]
        rates = {("A", "01", "0001"): D("18.00"),         # 1000 * 18 / 1200 = 15.00
                 ("DEFAULT", "01", "0002"): D("24.00"),    # 500 * 24 / 1200 = 10.00
                 ("DEFAULT", "01", "0001"): D("0.00")}     # account 2: zero rate
        res = run(self.two_accounts(), cats, rates)

        self.assertEqual([(t.id, t.amount) for t in res.trans],
                         [("2026-11-25000001", D("15.00")), ("2026-11-25000002", D("10.00"))])
        t = res.trans[0]
        self.assertEqual((t.type_cd, t.cat_cd, t.source), ("01", "0005", "System"))
        self.assertEqual(t.desc, "Int. for a/c 00000000001")
        self.assertEqual((t.card, t.orig_ts, t.proc_ts), (CARD1, NOW_TS, NOW_TS))
        self.assertEqual((t.merchant_name, t.merchant_city, t.merchant_zip), ("", "", ""))
        self.assertEqual(t.merchant_id, "000000000")

        a1, a2 = res.accounts[A1], res.accounts[A2]
        self.assertEqual(a1.balance, D("125.00"))
        self.assertEqual((a1.cycle_credit, a1.cycle_debit), (D("0.00"), D("0.00")))
        self.assertEqual(a2.balance, D("50.00"))                      # no interest, cycle reset
        self.assertEqual((a2.cycle_credit, a2.cycle_debit), (D("0.00"), D("0.00")))

    def test_rounding_truncates_to_the_cent_as_the_cobol_does(self):
        # Approved I3: truncation toward zero, matching the COBOL.
        rates = {("A", "01", "0001"): D("0.06"), ("A", "01", "0002"): D("18.00")}
        cats = [catbal(A1, "01", "0001", "100.00"),    # 0.005 -> 0.00, so no row
                catbal(A1, "01", "0002", "100.10")]    # 1.5015 -> 1.50 (not 1.51)
        res = run([account(A1)], cats, rates, [xref(CARD1, A1)])
        self.assertEqual([t.amount for t in res.trans], [D("1.50")])

    def test_zero_or_negative_balance_makes_no_interest(self):
        rates = {("A", "01", "0001"): D("18.00"), ("A", "01", "0002"): D("18.00")}
        cats = [catbal(A1, "01", "0001", "0.00"), catbal(A1, "01", "0002", "-100.00")]
        res = run([account(A1, balance="10.00")], cats, rates, [xref(CARD1, A1)])
        self.assertEqual(res.trans, [])
        self.assertEqual(res.accounts[A1].balance, D("10.00"))

    def test_counter_runs_across_accounts_and_input_order_does_not_matter(self):
        rates = {("A", "01", "0001"): D("12.00"), ("B", "01", "0001"): D("12.00")}
        cats = [catbal(A2, "01", "0001", "100.00"), catbal(A1, "01", "0001", "100.00")]
        res = run(self.two_accounts(), cats, rates)
        self.assertEqual([(t.id, t.card) for t in res.trans],
                         [("2026-11-25000001", CARD1), ("2026-11-25000002", CARD2)])

    def test_account_without_category_rows_is_untouched(self):
        accts = self.two_accounts()
        res = run(accts, [catbal(A1, "01", "0001", "0.00")], {("A", "01", "0001"): D("1.00")})
        self.assertEqual(res.accounts[A2], accts[1])

    def test_lowest_card_number_is_used_when_account_has_two_cards(self):
        xrefs = [xref("4000000000000009", A1), xref("4000000000000003", A1)]
        res = run([account(A1)], [catbal(A1, "01", "0001", "100.00")],
                  {("A", "01", "0001"): D("12.00")}, xrefs)
        self.assertEqual(res.trans[0].card, "4000000000000003")

    def test_inputs_are_not_changed(self):
        accts, xr, cats = stores([account(A1)], [xref(CARD1, A1)], [catbal(A1, "01", "0001", "100.00")])
        compute_interest(cats, {("A", "01", "0001"): D("12.00")}, accts, xr, RUN_DATE, NOW)
        self.assertEqual(accts[A1].balance, D("100.00"))


class InterestFailureTest(unittest.TestCase):
    def test_missing_rate_and_missing_default_stops_the_run(self):
        with self.assertRaises(ConfigError):
            run([account(A1)], [catbal(A1, "01", "0001", "100.00")], {})

    def test_account_not_found_stops_the_run(self):
        with self.assertRaises(DataError):
            run([], [catbal(A1, "01", "0001", "100.00")], {("A", "01", "0001"): D("1.00")},
                [xref(CARD1, A1)])

    def test_interest_due_but_no_card_stops_the_run(self):
        with self.assertRaises(DataError):
            run([account(A1)], [catbal(A1, "01", "0001", "100.00")],
                {("A", "01", "0001"): D("12.00")}, [])

    def test_no_card_is_fine_when_no_interest_is_due(self):
        res = run([account(A1)], [catbal(A1, "01", "0001", "100.00")],
                  {("A", "01", "0001"): D("0.00")}, [])
        self.assertEqual(res.trans, [])


if __name__ == "__main__":
    unittest.main()
