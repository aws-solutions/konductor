import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sample_database():
    directory = tempfile.TemporaryDirectory()
    path = Path(directory.name) / "sample.sqlite"
    with sqlite3.connect(path) as connection:
        connection.executescript((ROOT / "fixtures/schema.sql").read_text())
        connection.executescript((ROOT / "fixtures/sample.sql").read_text())
    return directory, path
