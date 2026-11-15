# SPDX-License-Identifier: Apache-2.0
import unittest

import _paths  # noqa: F401
from plant_gateway.approval import ApprovalBook

OPERATOR = {"approvals": {"open_guard": "granted"}, "expireAfterMs": 1000}


class ApprovalBookTest(unittest.TestCase):
    def test_the_operator_answer_sets_the_record_status(self):
        for answer, status in (("granted", "granted"), ("refused", "refused"), ("none", "pending")):
            book = ApprovalBook({"approvals": {"open_guard": answer}, "expireAfterMs": 1000})
            self.assertEqual(book.request("open_guard", "c0", 0).status, status, answer)

    def test_an_action_the_operator_block_does_not_name_stays_pending(self):
        self.assertEqual(ApprovalBook({}).request("open_guard", "c0", 0).status, "pending")

    def test_a_granted_record_is_live_until_its_expiry(self):
        book = ApprovalBook(OPERATOR)
        book.request("open_guard", "c0", 100)
        self.assertIsNotNone(book.live("open_guard", 1099))
        self.assertIsNone(book.live("open_guard", 1100))

    def test_expire_marks_and_returns_records_past_their_time(self):
        book = ApprovalBook(OPERATOR)
        record = book.request("open_guard", "c0", 0)
        self.assertEqual((book.expire(999), book.expire(1000)), ([], [record]))
        self.assertEqual(record.status, "expired")

    def test_a_pending_record_expires_too(self):
        book = ApprovalBook({"approvals": {"open_guard": "none"}, "expireAfterMs": 10})
        book.request("open_guard", "c0", 0)
        self.assertEqual(book.expire(10)[0].status, "expired")

    def test_a_used_record_is_no_longer_live(self):
        book = ApprovalBook(OPERATOR)
        record = book.request("open_guard", "c0", 0)
        book.consume(record, "c3")
        self.assertIsNone(book.live("open_guard", 10))

    def test_a_record_cannot_be_used_twice(self):
        book = ApprovalBook(OPERATOR)
        record = book.request("open_guard", "c0", 0)
        book.consume(record, "c3")
        with self.assertRaises(ValueError):
            book.consume(record, "c4")

    def test_a_refused_record_is_never_live(self):
        book = ApprovalBook({"approvals": {"open_guard": "refused"}, "expireAfterMs": 1000})
        book.request("open_guard", "c0", 0)
        self.assertIsNone(book.live("open_guard", 1))


if __name__ == "__main__":
    unittest.main()
