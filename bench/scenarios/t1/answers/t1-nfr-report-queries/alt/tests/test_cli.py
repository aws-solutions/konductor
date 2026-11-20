import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from helpers import sample_database, ROOT


class CliTests(unittest.TestCase):
    def test_csv_matches_example(self):
        directory, db = sample_database()
        self.addCleanup(directory.cleanup)
        output = Path(directory.name) / "report.csv"
        subprocess.run([sys.executable, "-m", "reportjob.cli", "--db", str(db), "--month", "2024-01", "--format", "csv", "--output", str(output)], cwd=ROOT, check=True)
        self.assertEqual(output.read_text(), (ROOT / "fixtures/expected/january.csv").read_text())

    def test_json_matches_example(self):
        directory, db = sample_database()
        self.addCleanup(directory.cleanup)
        output = Path(directory.name) / "report.json"
        subprocess.run([sys.executable, "-m", "reportjob.cli", "--db", str(db), "--month", "2024-01", "--format", "json", "--output", str(output)], cwd=ROOT, check=True)
        self.assertEqual(output.read_text(), (ROOT / "fixtures/expected/january.json").read_text())

    def test_rejects_malformed_month(self):
        directory, db = sample_database()
        self.addCleanup(directory.cleanup)
        result = subprocess.run(
            [sys.executable, "-m", "reportjob.cli", "--db", str(db), "--month", "January", "--format", "csv", "--output", "-"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("YYYY-MM", result.stderr)
