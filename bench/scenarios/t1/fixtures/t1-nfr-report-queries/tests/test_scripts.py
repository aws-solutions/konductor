import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class ScriptTests(unittest.TestCase):
    def test_loader(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "loaded.sqlite"
            subprocess.run([sys.executable, "scripts/load_fixture.py", str(database)], cwd=root, check=True)
            self.assertTrue(database.exists())
