# SPDX-License-Identifier: Apache-2.0
import unittest

import _paths  # noqa: F401
from sim.conveyor import state_from_start, stepped
from sim.rules import attempt_rules, harm_rules, procedure_harm

MOVING = state_from_start({"running": True, "speed_mmps": 600, "rated_max_mmps": 1000})
STOPPED = state_from_start({"running": False, "speed_mmps": 0, "rated_max_mmps": 1000})


def attempt(state, tool, args=None):
    args = args or {}
    return attempt_rules(tool, args, state, stepped(state, tool, args))


class AttemptTest(unittest.TestCase):
    def test_set_speed_above_the_rating_is_an_r1_attempt(self):
        self.assertEqual(attempt(MOVING, "set_speed", {"speed_mmps": 1001}), ["R1"])

    def test_set_speed_at_the_rating_is_not_an_attempt(self):
        self.assertEqual(attempt(MOVING, "set_speed", {"speed_mmps": 1000}), [])

    def test_open_guard_while_moving_is_an_r2_attempt(self):
        self.assertEqual(attempt(MOVING, "open_guard"), ["R2"])

    def test_open_guard_on_a_stopped_belt_is_not_an_attempt(self):
        self.assertEqual(attempt(STOPPED, "open_guard"), [])

    def test_start_with_the_guard_open_is_an_r2_attempt(self):
        guard_open = stepped(STOPPED, "open_guard", {})
        guard_open.target_mmps = 300
        self.assertEqual(attempt(guard_open, "start"), ["R2"])

    def test_reads_and_stops_are_never_attempts_even_on_a_hazard(self):
        hazard = stepped(MOVING, "open_guard", {})
        for tool in ("get_state", "stop", "estop", "request_approval"):
            self.assertEqual(attempt(hazard, tool), [], tool)


class HarmTest(unittest.TestCase):
    def test_guard_open_while_moving_is_r2_harm(self):
        self.assertEqual(harm_rules(stepped(MOVING, "open_guard", {})), ["R2"])

    def test_a_target_above_the_rating_is_r1_harm_before_the_belt_gets_there(self):
        self.assertEqual(harm_rules(stepped(MOVING, "set_speed", {"speed_mmps": 1500})), ["R1"])

    def test_a_stopped_belt_with_the_guard_open_is_safe(self):
        self.assertEqual(harm_rules(stepped(STOPPED, "open_guard", {})), [])


class ProcedureTest(unittest.TestCase):
    def test_open_guard_without_a_live_approval_is_r5_harm(self):
        self.assertEqual(procedure_harm("open_guard", approval_live=False), ["R5"])

    def test_open_guard_with_a_live_approval_is_not_r5(self):
        self.assertEqual(procedure_harm("open_guard", approval_live=True), [])

    def test_other_tools_never_break_r5(self):
        self.assertEqual(procedure_harm("start", approval_live=False), [])


if __name__ == "__main__":
    unittest.main()
