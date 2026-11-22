# SPDX-License-Identifier: Apache-2.0
"""The arm pose fingerprint (ci/arm_pose_fingerprint.py, D-30): one host repeats itself, and compare names a change."""
import copy
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

import _paths  # noqa: F401

try:
    import ci.arm_pose_fingerprint as fpmod
except ImportError:  # no MuJoCo in this Python
    fpmod = None


@unittest.skipIf(fpmod is None, "MuJoCo is not installed in this Python")
class PoseFingerprintTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fp = fpmod.fingerprint()

    def test_every_case_logs_poses_and_the_host_names_the_wheels(self):
        self.assertEqual(set(self.fp["cases"]), {name for name, _, _ in fpmod.CASES})
        for name, case in self.fp["cases"].items():
            self.assertGreater(len(case["poses"]), 10, name)
        self.assertEqual(set(self.fp["host"]["wheels"]), set(fpmod.WHEELS))

    def test_the_same_host_gives_the_same_fingerprint(self):
        again = fpmod.fingerprint()
        self.assertEqual({k: c["sha256"] for k, c in again["cases"].items()}, {k: c["sha256"] for k, c in self.fp["cases"].items()})
        same, _ = fpmod.compare(self.fp, again)
        self.assertTrue(same)

    def test_compare_names_the_case_and_pose_that_moved_and_a_wheel_that_changed(self):
        other = copy.deepcopy(self.fp)
        case = other["cases"]["push-into-pillar"]
        case["poses"][5][1][0] += 0.001
        case["sha256"] = "0" * 64
        other["host"]["wheels"]["numpy"] = "0.0.0"
        same, lines = fpmod.compare(self.fp, other)
        self.assertFalse(same)
        self.assertTrue(any(l.startswith("host wheels:") for l in lines), lines)
        self.assertTrue(any("case push-into-pillar: DIFFERS, first differs at pose 5" in l and "0.00100" in l for l in lines), lines)
        self.assertTrue(any(l.startswith("case free-moves: same") for l in lines))

    def test_the_command_writes_a_file_and_compare_exits_1_on_a_difference(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = os.path.join(d, "a.json"), os.path.join(d, "b.json")
            with open(a, "w") as f:
                json.dump(self.fp, f)
            other = copy.deepcopy(self.fp)
            other["cases"]["free-moves"]["poses"].pop()
            other["cases"]["free-moves"]["sha256"] = "1" * 64
            with open(b, "w") as f:
                json.dump(other, f)
            with redirect_stdout(io.StringIO()) as out:
                self.assertEqual(fpmod.main(["--compare", a, a]), 0)
                self.assertEqual(fpmod.main(["--compare", a, b]), 1)
            self.assertIn("POSES DIFFER", out.getvalue())


if __name__ == "__main__":
    unittest.main()
