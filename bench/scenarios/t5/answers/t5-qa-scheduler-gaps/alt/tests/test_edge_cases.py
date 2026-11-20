# Changes for this request; see the commit message for the reasoning.
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from schedulerlib.persistence import StateStore
from schedulerlib.priority_queue import PriorityQueue
from schedulerlib.rate_limiter import SlidingWindowLimiter
from schedulerlib.retry import RetryFailure, RetryPolicy
from schedulerlib.scheduler import CronField, Schedule


class CalendarAndReliabilityEdgeTests(unittest.TestCase):
    def test_step_range_does_not_escape_its_end(self):
        field = CronField("5-17/5", 0, 59)
        self.assertEqual(field.values, frozenset({5, 10, 15}))
        self.assertEqual(
            Schedule("5-17/5 * * * *").next_run(datetime(2025, 1, 1, 0, 15)),
            datetime(2025, 1, 1, 1, 5),
        )

    def test_first_day_after_month_end_is_not_skipped(self):
        schedule = Schedule("0 0 1 2 *")
        self.assertEqual(
            schedule.next_run(datetime(2025, 1, 31, 23, 0)),
            datetime(2025, 2, 1, 0, 0),
        )

    def test_leap_day_is_reachable(self):
        schedule = Schedule("0 0 29 2 *")
        self.assertEqual(
            schedule.next_run(datetime(2024, 2, 28, 23, 0)),
            datetime(2024, 2, 29, 0, 0),
        )

    def test_fixed_timezone_offset_survives_next_run(self):
        offset = timezone(timedelta(hours=-5))
        after = datetime(2025, 3, 10, 11, 0, tzinfo=offset)
        result = Schedule("0 12 * * *").next_run(after)
        self.assertEqual(result, datetime(2025, 3, 10, 12, 0, tzinfo=offset))
        self.assertIs(result.tzinfo, offset)

    def test_delay_at_cap_is_exactly_the_cap(self):
        policy = RetryPolicy(base_delay=3, multiplier=2, max_delay=12)
        self.assertEqual(policy.delay_for(3), 12.0)

    def test_retry_stops_after_configured_attempts(self):
        calls = []

        def failing_operation():
            calls.append(len(calls) + 1)
            raise RuntimeError("downstream unavailable")

        with self.assertRaises(RetryFailure):
            RetryPolicy(max_attempts=3, base_delay=0).run(failing_operation, lambda _: None)
        self.assertEqual(calls, [1, 2, 3])

    def test_equal_priority_items_keep_insertion_order(self):
        queue = PriorityQueue()
        queue.put("first", priority=4)
        queue.put("second", priority=4)
        queue.put("third", priority=4)
        self.assertEqual([queue.get(), queue.get(), queue.get()], ["first", "second", "third"])

    def test_event_expires_at_the_window_edge(self):
        limiter = SlidingWindowLimiter(limit=1, window_seconds=10)
        self.assertTrue(limiter.allow("worker", now=20))
        self.assertTrue(limiter.allow("worker", now=30))

    def test_empty_state_file_is_empty_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text("")
            self.assertEqual(StateStore(path).load(), {})

    def test_corrupt_state_file_is_empty_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text("{not valid json")
            self.assertEqual(StateStore(path).load(), {})
