"""R1-R8: report and statement rules, checked against hand-worked lines."""
import unittest
from decimal import Decimal

from carddemo_port.editing import balance_amount, detail_amount, statement_amount, total_amount
from carddemo_port.errors import DataError
from carddemo_port.records import Customer, TranCat, TranType
from carddemo_port.report import build_report
from carddemo_port.statements import build_statements, statement
from tests.helpers import D, account, tran, xref

TYPES = {"01": TranType("01", "Purchase")}
CATS = {("01", "0001"): TranCat("01", "0001", "Regular Sales Draft")}
XREF = {"4000000000000001": xref(), "4000000000000002": xref(card="4000000000000002", acct="00000000002")}


def posted(n, amount="1.00", card="4000000000000001", day="2026-11-10"):
    from dataclasses import replace
    return replace(tran(tran_id="%016d" % n, amount=amount, card=card), proc_ts=day + " 12:00:00.000000")


def customer(**o):
    d = dict(id="000000001", first="John", middle="Q", last="Public", addr1="1 Main St", addr2="Apt 2",
             addr3="Springfield", state="IL", country="USA", zip="62701", fico="700")
    d.update(o)
    return Customer(**d)


def report(trans, start="2026-11-01", end="2026-11-30"):
    return build_report(trans, XREF, TYPES, CATS, start, end)[0]


class EditingTest(unittest.TestCase):
    def test_pictures_keep_width_sign_and_units_digit(self):
        self.assertEqual(detail_amount(D("0.05")), "           0.05")
        self.assertEqual(detail_amount(D("-12.30")), "-         12.30")
        self.assertEqual(detail_amount(D("1234567.89")), "   1,234,567.89")
        self.assertEqual(total_amount(D("0.00")), "+          0.00")
        self.assertEqual(statement_amount(D("-0.99")), "        0.99-")
        self.assertEqual(balance_amount(D("877.34")), "000000877.34 ")

    def test_a_number_too_wide_is_refused(self):
        with self.assertRaises(DataError):
            detail_amount(D("1000000000.00"))


class ReportTest(unittest.TestCase):
    def test_r1_a_record_outside_the_range_is_skipped_and_the_run_goes_on(self):
        lines = report([posted(1, "1.00"), posted(2, "2.00", day="2026-09-01"), posted(3, "4.00")])
        self.assertEqual(sum(1 for line in lines if line.startswith("0000")), 2)
        self.assertTrue(lines[-1].endswith("+          5.00"))

    def test_r2_last_account_total_comes_before_the_page_total(self):
        lines = report([posted(1, "10.00"), posted(2, "7.25", card="4000000000000002")])
        kinds = [line.split(".")[0].strip() for line in lines if "...." in line]
        self.assertEqual(kinds, ["Account Total", "Account Total", "Page Total", "Grand Total"])
        self.assertTrue(lines[-1].endswith("+         17.25"))

    def test_r3_empty_selection_has_headings_and_zero_totals(self):
        lines = report([])
        self.assertEqual(len(lines), 7)
        self.assertTrue(lines[-1].endswith("+          0.00"))

    def test_r4_unknown_card_stops_the_run(self):
        with self.assertRaises(DataError):
            report([posted(1, card="4999999999999999")])

    def test_page_break_when_the_count_reaches_a_multiple_of_twenty(self):
        lines = report([posted(n) for n in range(1, 18)])
        pages = [i for i, line in enumerate(lines) if line.startswith("Page Total")]
        self.assertEqual(len(pages), 2)
        self.assertTrue(lines[pages[0]].endswith("+         16.00"))
        self.assertEqual(len([line for line in lines[:pages[0]] if line.startswith("0000")]), 16)


class StatementTest(unittest.TestCase):
    def test_a_statement_for_two_transactions(self):
        text, html, total = statement(customer(), account(balance="100.00"), [posted(1, "12.30"), posted(2, "-5.00")])
        self.assertEqual(total, Decimal("7.30"))
        self.assertEqual(text[1].rstrip(), "John Q Public")
        self.assertEqual(text[-2], "Total EXP:" + " " * 56 + "$        7.30 ")
        self.assertEqual(html[0].rstrip(), "<!DOCTYPE html>")
        self.assertEqual(html[-1], "</html>")

    def test_no_middle_name_keeps_two_blanks_in_text_and_cuts_the_html_name(self):
        text, html, _ = statement(customer(middle=""), account(), [])
        self.assertEqual(text[1].rstrip(), "John  Public")
        self.assertIn('<p style="font-size:16px">John  </p>', html)

    def test_r6_cards_by_number_and_more_than_ten_transactions(self):
        trans = [posted(n) for n in range(30, 11, -1)]
        text, _, cards, count, skipped = build_statements(
            trans, {x.card: x for x in [xref()]}, {"000000001": customer()}, {"00000000001": account()})
        self.assertEqual((cards, count, skipped), (1, 19, 0))
        ids = [line[:16] for line in text if line[:15].isdigit() and line[16] == " "]
        self.assertEqual(ids, sorted(ids))

    def test_r8_missing_account_skips_the_card(self):
        _, _, cards, count, skipped = build_statements(
            [posted(1)], {x.card: x for x in [xref()]}, {"000000001": customer()}, {})
        self.assertEqual((cards, count, skipped), (0, 0, 1))


if __name__ == "__main__":
    unittest.main()
