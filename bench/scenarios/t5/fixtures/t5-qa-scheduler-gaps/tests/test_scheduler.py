import unittest
from datetime import datetime

from schedulerlib.scheduler import CronField, Schedule


class ScheduleTests(unittest.TestCase):
    def test_hourly_rule_moves_to_next_hour(self):
        schedule = Schedule("0 * * * *")
        self.assertEqual(schedule.next_run(datetime(2025, 4, 9, 10, 12)), datetime(2025, 4, 9, 11, 0))

    def test_weekday_and_hour_rule(self):
        schedule = Schedule("30 9 * * 0-4")
        self.assertEqual(schedule.next_run(datetime(2025, 4, 9, 8, 0)), datetime(2025, 4, 9, 9, 30))

    def test_lists_and_steps(self):
        self.assertEqual(CronField("*/15", 0, 59).values, frozenset({0, 15, 30, 45}))
        schedule = Schedule("0,30 8,16 * * *")
        self.assertEqual(schedule.next_run(datetime(2025, 4, 9, 8, 1)), datetime(2025, 4, 9, 8, 30))

    def test_month_filter(self):
        schedule = Schedule("0 12 15 6,7 *")
        self.assertEqual(schedule.next_run(datetime(2025, 5, 20, 1, 0)), datetime(2025, 6, 15, 12, 0))

    def test_invalid_expressions(self):
        with self.assertRaises(ValueError):
            Schedule("0 0 * *")
        with self.assertRaises(ValueError):
            CronField("61", 0, 59)
        with self.assertRaises(ValueError):
            CronField("*/0", 0, 59)

    def test_matches(self):
        schedule = Schedule("5 7 9 4 2")
        self.assertTrue(schedule.matches(datetime(2025, 4, 9, 7, 5)))
        self.assertFalse(schedule.matches(datetime(2025, 4, 9, 7, 6)))
