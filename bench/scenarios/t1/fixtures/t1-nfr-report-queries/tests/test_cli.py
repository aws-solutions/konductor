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
