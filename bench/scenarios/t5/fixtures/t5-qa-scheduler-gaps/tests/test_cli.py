import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from schedulerlib.cli import main


class CliTests(unittest.TestCase):
    def test_schedule_command(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(main(["schedule", "0 8 * * *", "--after", "2025-04-09T07:00:00"]), 0)
        self.assertIn("2025-04-09T08:00:00", output.getvalue())

    def test_state_command(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text('{"one": 1, "two": 2}')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main(["state", str(path)]), 0)
            self.assertEqual(output.getvalue().strip(), "2")
