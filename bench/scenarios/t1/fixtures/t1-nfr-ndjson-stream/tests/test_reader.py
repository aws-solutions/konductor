import tempfile
import unittest
from pathlib import Path

from logjob.reader import read_records


class ReaderTests(unittest.TestCase):
    def test_skips_bad_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.ndjson"
            path.write_text("bad\n{\"endpoint\": \"/ok\", \"latency_ms\": 2, \"status\": 200}\n", encoding="utf-8")
            self.assertEqual(len(read_records(path)), 1)
