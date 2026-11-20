import json
import unittest

from logjob.formatting import render_summary


class FormattingTests(unittest.TestCase):
    def test_render_is_json_with_newline(self):
        text = render_summary({"total_records": 0, "endpoints": {}})
        self.assertTrue(text.endswith("\n"))
        self.assertEqual(json.loads(text)["total_records"], 0)
