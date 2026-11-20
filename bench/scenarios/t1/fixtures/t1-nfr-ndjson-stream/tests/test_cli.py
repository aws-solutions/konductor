import json
import tempfile
import unittest
from pathlib import Path

from logjob.cli import main


class CliTests(unittest.TestCase):
    def test_command_writes_json(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.ndjson"
            target = Path(directory) / "out" / "report.json"
            source.write_text('{"endpoint":"/cli","latency_ms":4,"status":200}\n', encoding="utf-8")
            self.assertEqual(main(["--input", str(source), "--output", str(target)]), 0)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["total_records"], 1)
