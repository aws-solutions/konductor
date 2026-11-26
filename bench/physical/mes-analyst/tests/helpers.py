"""Shared test helpers: a fresh fixture database and output folder per test."""
import hashlib
import os
import tempfile
import unittest

from mes_analyst import fixture


def file_sha256(path):
    """The sha256 hex digest of the file at `path`."""
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class DbCase(unittest.TestCase):
    """Builds `mes.db` (seed 7) in a temp folder, plus an empty `out` folder, and removes both after the test."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="mes-test-")
        self.root = self._tmp.name
        self.db = fixture.build(os.path.join(self.root, "mes.db"), seed=7)
        self.out = os.path.join(self.root, "out")
        os.mkdir(self.out)
        self.db_sha = file_sha256(self.db)

    def tearDown(self):
        self._tmp.cleanup()

    def assertDbUnchanged(self):
        """Fails when the database file bytes differ from the build."""
        self.assertEqual(file_sha256(self.db), self.db_sha, "mes.db changed")
