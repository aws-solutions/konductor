import importlib
import unittest


class SmokeTest(unittest.TestCase):
    def test_modules_load(self):
        self.assertIsNotNone(importlib.import_module("scripts.inspect_rates"))
        self.assertIsNotNone(importlib.import_module("scripts.make_manifest"))


if __name__ == '__main__':
    unittest.main()
