import json
import tempfile
import unittest
from pathlib import Path

from schedulerlib.persistence import StateStore


class PersistenceTests(unittest.TestCase):
    def test_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            store = StateStore(Path(directory) / "state.json")
            store.save({"last": "2025-04-09", "count": 3})
            self.assertEqual(store.load(), {"last": "2025-04-09", "count": 3})

    def test_missing_state_is_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(StateStore(Path(directory) / "none.json").load(), {})

    def test_saved_json_is_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            StateStore(path).save({"ready": True})
            self.assertEqual(json.loads(path.read_text()), {"ready": True})

    def test_state_must_be_an_object(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(TypeError):
                StateStore(Path(directory) / "state.json").save([])
