import importlib
import unittest


class SmokeTest(unittest.TestCase):
    def test_modules_load(self):
        self.assertIsNotNone(importlib.import_module("schedulerlib.__main__"))
        self.assertIsNotNone(importlib.import_module("schedulerlib.cli"))
        self.assertIsNotNone(importlib.import_module("schedulerlib.persistence"))
        self.assertIsNotNone(importlib.import_module("schedulerlib.priority_queue"))
        self.assertIsNotNone(importlib.import_module("schedulerlib.rate_limiter"))
        self.assertIsNotNone(importlib.import_module("schedulerlib.retry"))
        self.assertIsNotNone(importlib.import_module("schedulerlib.scheduler"))
        self.assertIsNotNone(importlib.import_module("scripts.check_state"))
        self.assertIsNotNone(importlib.import_module("scripts.show_schedule"))


if __name__ == '__main__':
    unittest.main()
