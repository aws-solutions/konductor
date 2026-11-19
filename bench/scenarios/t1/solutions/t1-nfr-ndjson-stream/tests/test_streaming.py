import tempfile
import unittest
from pathlib import Path

from logjob import analyze


class StreamingReportTests(unittest.TestCase):
    def test_empty_file_reports_no_malformed_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.ndjson"
            path.write_text("", encoding="utf-8")
            self.assertEqual(analyze(path)["malformed_lines"], 0)

    def test_bad_line_is_not_a_record(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mixed.ndjson"
            path.write_text("bad\n{\"endpoint\":\"/ok\",\"latency_ms\":1,\"status\":200}\n", encoding="utf-8")
            report = analyze(path)
            self.assertEqual(report["malformed_lines"], 1)
            self.assertEqual(report["total_records"], 1)
