"""M2, M3, T1, T7: the zoned-decimal codec and record parsing."""
import unittest
from dataclasses import replace
from decimal import Decimal

from carddemo_port import fixedwidth as fw
from carddemo_port.errors import DataError
from tests.helpers import account, tran, xref, catbal


class ZonedDecimalTest(unittest.TestCase):
    def test_decode_positive_digits(self):
        self.assertEqual(fw.decode_signed("0000005047G"), Decimal("504.77"))
        self.assertEqual(fw.decode_signed("00000000100{"), Decimal("10.00"))

    def test_decode_negative_digits(self):
        self.assertEqual(fw.decode_signed("0000009190}"), Decimal("-919.00"))
        self.assertEqual(fw.decode_signed("0000000001J"), Decimal("-0.11"))

    def test_decode_unsigned_digits_are_positive(self):
        self.assertEqual(fw.decode_signed("000000012345"), Decimal("123.45"))

    def test_decode_rejects_bad_text(self):
        for bad in ("00000a0000{", "", "   ", "0000000000!"):
            with self.subTest(bad=bad), self.assertRaises(DataError):
                fw.decode_signed(bad)

    def test_encode_round_trip(self):
        for value in ("0.00", "50.47", "-91.90", "-0.01", "9999999999.99"):
            with self.subTest(value=value):
                text = fw.encode_signed(Decimal(value), 12)
                self.assertEqual(len(text), 12)
                self.assertEqual(fw.decode_signed(text), Decimal(value))

    def test_encode_known_values(self):
        self.assertEqual(fw.encode_signed(Decimal("504.77"), 11), "0000005047G")
        self.assertEqual(fw.encode_signed(Decimal("-919.00"), 11), "0000009190}")

    def test_encode_rejects_too_wide_and_extra_places(self):
        with self.assertRaises(DataError):
            fw.encode_signed(Decimal("1000000000.00"), 11)
        with self.assertRaises(DataError):
            fw.encode_signed(Decimal("1.005"), 11)


class RecordRoundTripTest(unittest.TestCase):
    def test_account_round_trip_and_width(self):
        a = account(balance="-12.34", cyc_debit="-5.00")
        line = fw.format_account(a)
        self.assertEqual(len(line), 300)
        self.assertEqual(fw.parse_account(line), a)

    def test_tran_round_trip_and_width(self):
        t = tran(amount="-91.90")
        line = fw.format_tran(t)
        self.assertEqual(len(line), 350)
        self.assertEqual(fw.parse_tran(line), t)

    def test_xref_and_catbal_round_trip(self):
        self.assertEqual(fw.parse_xref(fw.format_xref(xref())), xref())
        self.assertEqual(len(fw.format_catbal(catbal())), 50)
        self.assertEqual(fw.parse_catbal(fw.format_catbal(catbal(balance="7.50"))),
                         catbal(balance="7.50"))

    def test_short_line_is_padded(self):
        line = fw.format_xref(xref()).rstrip()
        self.assertEqual(fw.parse_xref(line), xref())

    def test_line_too_long_is_an_error(self):
        with self.assertRaises(DataError):
            fw.parse_xref(fw.format_xref(xref()) + "X")

    def test_control_character_in_text_is_an_error(self):
        line = fw.format_tran(tran())
        bad = line[:30] + "\x07" + line[31:]
        with self.assertRaises(DataError):
            fw.parse_tran(bad)

    def test_long_description_is_cut_to_width_on_output(self):
        t = tran()
        long_t = replace(t, desc="x" * 300)
        self.assertEqual(len(fw.format_tran(long_t)), 350)

    def test_bad_number_names_the_field(self):
        line = fw.format_catbal(catbal())
        bad = line[:17] + "ZZZZZZZZZZZ" + line[28:]
        with self.assertRaises(DataError) as ctx:
            fw.parse_catbal(bad)
        self.assertIn("balance", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
