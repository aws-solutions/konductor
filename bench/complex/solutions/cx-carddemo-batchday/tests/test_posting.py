"""P1-P13, T3, T10: posting rules, checked against hand-worked numbers."""
import unittest
from copy import deepcopy
from decimal import Decimal

from carddemo_port.posting import post_transactions
from tests.helpers import NOW, NOW_TS, D, account, catbal, stores, tran, xref

ACCT = "00000000001"


def run(trans, accounts=(), xrefs=(), catbals=()):
    accts, xr, cats = stores(accounts or [account()], xrefs or [xref()], catbals)
    return post_transactions(trans, xr, accts, cats, NOW), accts, cats


class PostTest(unittest.TestCase):
    def test_valid_purchase_posts_and_updates_balances(self):
        res, _, _ = run([tran(amount="50.47")])
        self.assertEqual(len(res.posted), 1)
        self.assertEqual(res.rejects, [])
        self.assertEqual(res.posted[0].proc_ts, NOW_TS)
        acct = res.accounts[ACCT]
        self.assertEqual(acct.balance, D("150.47"))
        self.assertEqual(acct.cycle_credit, D("50.47"))
        self.assertEqual(acct.cycle_debit, D("0.00"))
        self.assertEqual(res.catbals[(ACCT, "01", "0001")].balance, D("50.47"))

    def test_negative_amount_goes_to_cycle_debit(self):
        res, _, _ = run([tran(amount="-30.00")])
        acct = res.accounts[ACCT]
        self.assertEqual(acct.balance, D("70.00"))
        self.assertEqual(acct.cycle_debit, D("-30.00"))
        self.assertEqual(acct.cycle_credit, D("0.00"))

    def test_zero_amount_counts_as_credit_side(self):
        res, _, _ = run([tran(amount="0.00")])
        self.assertEqual(res.accounts[ACCT].cycle_credit, D("0.00"))
        self.assertEqual(len(res.posted), 1)

    def test_existing_category_row_is_added_to(self):
        res, _, _ = run([tran(amount="5.00")], catbals=[catbal(balance="20.00")])
        self.assertEqual(res.catbals[(ACCT, "01", "0001")].balance, D("25.00"))

    def test_different_category_makes_a_new_row(self):
        res, _, _ = run([tran(cat_cd="0002", amount="5.00")], catbals=[catbal(balance="20.00")])
        self.assertEqual(res.catbals[(ACCT, "01", "0001")].balance, D("20.00"))
        self.assertEqual(res.catbals[(ACCT, "01", "0002")].balance, D("5.00"))

    def test_inputs_are_not_changed(self):
        accts, xr, cats = stores([account()], [xref()], [catbal(balance="1.00")])
        before = deepcopy((accts, xr, cats))
        post_transactions([tran()], xr, accts, cats, NOW)
        self.assertEqual((accts, xr, cats), before)


class RejectTest(unittest.TestCase):
    def assert_one_reject(self, res, code, text):
        self.assertEqual(res.posted, [])
        self.assertEqual([(r.code, r.text) for r in res.rejects], [(code, text)])

    def test_unknown_card_is_100(self):
        res, _, _ = run([tran(card="9999999999999999")])
        self.assert_one_reject(res, 100, "INVALID CARD NUMBER FOUND")

    def test_card_with_missing_account_is_101(self):
        res, _, _ = run([tran()], xrefs=[xref(acct="00000000099")])
        self.assert_one_reject(res, 101, "ACCOUNT RECORD NOT FOUND")

    def test_expiry_day_is_allowed_next_day_is_103(self):
        ok, _, _ = run([tran(orig_ts="2030-01-01 23:59:59.000000")])
        self.assertEqual(len(ok.posted), 1)
        res, _, _ = run([tran(orig_ts="2030-01-02 00:00:00.000000")])
        self.assert_one_reject(res, 103, "TRANSACTION RECEIVED AFTER ACCT EXPIRATION")

    def test_exact_limit_is_allowed_one_cent_over_is_102(self):
        acct = account(limit="1000.00", cyc_credit="900.00")
        ok, _, _ = run([tran(amount="100.00")], accounts=[acct])
        self.assertEqual(len(ok.posted), 1)
        res, _, _ = run([tran(amount="100.01")], accounts=[acct])
        self.assert_one_reject(res, 102, "OVERLIMIT TRANSACTION")

    def test_payments_net_against_charges_in_the_limit_check(self):
        acct = account(limit="1000.00", cyc_credit="900.00", cyc_debit="-300.00")
        ok, _, _ = run([tran(amount="350.00")], accounts=[acct])   # 900-300+350 = 950
        self.assertEqual(len(ok.posted), 1)
        res, _, _ = run([tran(amount="400.01")], accounts=[acct])  # 1000.01
        self.assert_one_reject(res, 102, "OVERLIMIT TRANSACTION")

    def test_expired_and_overlimit_reports_103(self):
        acct = account(limit="10.00")
        res, _, _ = run([tran(amount="50.00", orig_ts="2031-01-01 00:00:00.000000")],
                        accounts=[acct])
        self.assert_one_reject(res, 103, "TRANSACTION RECEIVED AFTER ACCT EXPIRATION")

    def test_duplicate_id_is_104_and_posts_once(self):
        res, _, _ = run([tran(amount="10.00"), tran(amount="10.00")])
        self.assertEqual(len(res.posted), 1)
        self.assertEqual([(r.code, r.text) for r in res.rejects],
                         [(104, "DUPLICATE TRANSACTION ID")])
        self.assertEqual(res.accounts[ACCT].balance, D("110.00"))

    def test_duplicate_of_a_rejected_id_is_also_104(self):
        res, _, _ = run([tran(card="9999999999999999"), tran()])
        self.assertEqual([r.code for r in res.rejects], [100, 104])
        self.assertEqual(res.posted, [])

    def test_rejected_transaction_changes_no_balance(self):
        res, _, _ = run([tran(amount="5000.00")])
        self.assertEqual(res.accounts[ACCT].balance, D("100.00"))
        self.assertEqual(res.accounts[ACCT].cycle_credit, D("0.00"))
        self.assertEqual(res.catbals, {})

    def test_later_transactions_see_earlier_postings(self):
        trans = [tran(tran_id="0000000000000001", amount="600.00"),
                 tran(tran_id="0000000000000002", amount="400.00"),
                 tran(tran_id="0000000000000003", amount="0.01")]
        res, _, _ = run(trans)
        self.assertEqual([t.id for t in res.posted], [trans[0].id, trans[1].id])
        self.assertEqual([(r.tran.id, r.code) for r in res.rejects], [(trans[2].id, 102)])
        self.assertEqual(res.accounts[ACCT].cycle_credit, D("1000.00"))

    def test_money_stays_decimal(self):
        res, _, _ = run([tran(amount="0.10"), tran(tran_id="0000000000000002", amount="0.20")])
        self.assertEqual(res.accounts[ACCT].balance, Decimal("100.30"))


if __name__ == "__main__":
    unittest.main()
