# SPDX-License-Identifier: Apache-2.0
import os
import sys
import tempfile
import unittest

from gateway_fixtures import write_stub_release
from truth_table_run import run

try:
    import cedarpy
except ImportError:
    cedarpy = None

STOPPED = {"running": False, "speed_mmps": 0, "target_mmps": 0, "rated_max_mmps": 1000, "guard": "closed",
           "estop": False, "jammed": False, "jam_since_ms": None, "person_in_zone": False}
MOVING = {**STOPPED, "running": True, "speed_mmps": 600, "target_mmps": 600}


def sensors(speed=0, t_ms=1000, person=False, jam=False):
    return {"speed": {"value": speed, "t_ms": t_ms}, "jam": {"value": jam, "t_ms": t_ms},
            "zone": {"person": person, "t_ms": t_ms}, "guard": {"value": "closed", "t_ms": t_ms}}


def row(action, expect, state=STOPPED, reading=None, approval="none", args=None, now_ms=1000):
    return {"state": state, "sensors": reading or sensors(), "now_ms": now_ms, "action": action, "args": args or {},
            "approval": approval, "expect": expect, "why": "stub"}


STUB_ROWS = [
    row("open_guard", "approval_required"),
    row("open_guard", "allow", approval="granted"),
    row("open_guard", "approval_required", approval="expired"),
    row("open_guard", "deny", state=MOVING, reading=sensors(speed=600), approval="granted"),
    row("set_speed", "allow", args={"speed_mmps": 1000}),
    row("set_speed", "deny", args={"speed_mmps": 1001}),
    row("set_speed", "bad_arguments", args={"speed_mmps": 700.5}),
    row("set_speed", "allow", args={"speed_mmps": 300}, reading=sensors(t_ms=500)),
    row("set_speed", "deny", args={"speed_mmps": 300}, reading=sensors(t_ms=499)),
    row("start", "deny", reading=sensors(person=7)),
    row("start", "deny", reading=sensors(jam=True)),
    row("stop", "allow", state=MOVING, reading=sensors(speed=600)),
]


@unittest.skipIf(cedarpy is None, "cedarpy is not installed in this Python")
class TruthTableRunTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.dir.cleanup()

    def release(self, rows):
        return write_stub_release(os.path.join(self.dir.name, "release"), rows)

    def test_every_stub_cell_and_the_wrong_token_pass(self):
        ok, lines = run(self.release(STUB_ROWS), sys.executable)
        self.assertTrue(ok, "\n".join(lines))
        self.assertEqual(lines[-1], f"{len(STUB_ROWS) + 1} of {len(STUB_ROWS) + 1} cells pass. This is a policy test only.")

    def test_a_wrong_expectation_is_reported_as_its_own_failed_cell(self):
        ok, lines = run(self.release([row("open_guard", "allow")]), sys.executable)
        self.assertFalse(ok)
        self.assertTrue(lines[0].startswith("FAIL row 1: open_guard"))
        self.assertIn("got=approval_required", lines[0])

    def test_a_policy_that_fails_validation_stops_the_run(self):
        release = self.release(STUB_ROWS)
        with open(os.path.join(release, "policy", "plant.cedar"), "a") as f:
            f.write('permit (principal, action, resource) when { context.nope };\n')
        ok, lines = run(release, sys.executable)
        self.assertFalse(ok)
        self.assertIn("policy_invalid", lines[0])


if __name__ == "__main__":
    unittest.main()
