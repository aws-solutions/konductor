import importlib
import unittest


class SmokeTest(unittest.TestCase):
    def test_modules_load(self):
        self.assertIsNotNone(importlib.import_module("ledger.cli"))
        self.assertIsNotNone(importlib.import_module("ledger.export"))
        self.assertIsNotNone(importlib.import_module("ledger.fees"))
        self.assertIsNotNone(importlib.import_module("ledger.interest"))
        self.assertIsNotNone(importlib.import_module("ledger.ledger"))
        self.assertIsNotNone(importlib.import_module("ledger.legacy"))
        self.assertIsNotNone(importlib.import_module("ledger.models"))
        self.assertIsNotNone(importlib.import_module("ledger.report"))
        self.assertIsNotNone(importlib.import_module("ledger.statement"))
        self.assertIsNotNone(importlib.import_module("scripts.demo"))


if __name__ == '__main__':
    unittest.main()
