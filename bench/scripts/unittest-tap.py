# SPDX-License-Identifier: Apache-2.0
"""Run the Python unittest files under a folder and print the results as TAP lines.

Used by bench/scripts/test.sh so one TAP stream lists the node and the Python tests. Each test is one line,
"ok N - py: <test id>" or "not ok N - py: <test id>", and a skip carries "# SKIP <reason>". The totals follow as
"# py tests", "# py pass", "# py fail" and "# py skipped" lines.

Usage: python unittest-tap.py <start dir> [<pattern>]   (pattern defaults to test_*.py)
Exit 0 when no test failed or errored, else 1; 2 when the folder holds no test.
"""
import sys
import unittest


class TapResult(unittest.TestResult):
    """A TestResult that prints one TAP line per finished test."""

    def __init__(self):
        super().__init__()
        self.n = 0

    def _line(self, test, ok, note=""):
        self.n += 1
        name = test.id().replace("\n", " ")
        print(f"{'ok' if ok else 'not ok'} {self.n} - py: {name}{note}", flush=True)

    def addSuccess(self, test):
        super().addSuccess(test)
        self._line(test, True)

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._line(test, False)

    def addError(self, test, err):
        super().addError(test, err)
        self._line(test, False)

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._line(test, True, f" # SKIP {' '.join(str(reason).split())}")

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._line(test, True)

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._line(test, False)


def main(argv):
    start = argv[1]
    pattern = argv[2] if len(argv) > 2 else "test_*.py"
    suite = unittest.defaultTestLoader.discover(start, pattern=pattern)
    result = TapResult()
    suite.run(result)
    # Tracebacks go to stderr so the TAP stream stays one line per test.
    for test, trace in result.failures + result.errors:
        print(f"--- py: {test.id()}\n{trace}", file=sys.stderr)
    bad = len(result.failures) + len(result.errors) + len(result.unexpectedSuccesses)
    print(f"1..{result.n}")
    print(f"# py tests {result.n}")
    print(f"# py pass {result.n - bad - len(result.skipped)}")
    print(f"# py fail {bad}")
    print(f"# py skipped {len(result.skipped)}")
    if result.n == 0:
        return 2
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
