# SPDX-License-Identifier: Apache-2.0
"""Per-test time limit for hidden Python tests: subclass TimedCase instead of unittest.TestCase.

A test that runs past LIMIT seconds raises TimeoutError, so one hung test fails alone and the others still run.
The tests check copies it into a task's hidden/py directory when the task's .bench-lib.json names it
(bench/runner/lib/hidden-lib.js); no task commits its own copy.
"""
import signal
import unittest

LIMIT = 10


class TimedCase(unittest.TestCase):
    def run(self, result=None):
        def _expired(signum, frame):
            raise TimeoutError(f"test ran longer than {LIMIT}s")

        previous = signal.signal(signal.SIGALRM, _expired)
        signal.alarm(LIMIT)
        try:
            return super().run(result)
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous)
