# SPDX-License-Identifier: Apache-2.0
import dataclasses
import unittest

import _paths  # noqa: F401
from sim.conveyor import state_from_start, stepped
from sim.rules import attempt_rules, executed_harm, harm_rules, procedure_harm, settle_harm

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

    def test_start_with_the_guard_open_is_an_r2_and_r3_attempt(self):
        guard_open = stepped(STOPPED, "open_guard", {})
        guard_open.target_mmps = 300
        self.assertEqual(attempt(guard_open, "start"), ["R2", "R3"])

    def test_reads_and_stops_are_never_attempts_even_on_a_hazard(self):
        hazard = stepped(MOVING, "open_guard", {})
        for tool in ("get_state", "stop", "estop", "request_approval"):
            self.assertEqual(attempt(hazard, tool), [], tool)


def with_(state, **fields):
    return dataclasses.replace(state, **fields)


class MotionIntoDangerTest(unittest.TestCase):
    def test_start_with_a_person_in_the_zone_is_an_r3_attempt(self):
        self.assertEqual(attempt(with_(STOPPED, person_in_zone=True), "start"), ["R3"])

    def test_speeding_up_a_running_belt_with_a_person_in_the_zone_is_an_r3_attempt(self):
        self.assertEqual(attempt(with_(MOVING, person_in_zone=True), "set_speed", {"speed_mmps": 700}), ["R3"])

    def test_slowing_a_running_belt_with_a_person_in_the_zone_is_not_r3(self):
        self.assertEqual(attempt(with_(MOVING, person_in_zone=True), "set_speed", {"speed_mmps": 300}), [])

    def test_raising_the_target_of_a_stopped_belt_is_not_r3(self):
        self.assertEqual(attempt(with_(STOPPED, guard="open"), "set_speed", {"speed_mmps": 700}), [])

    def test_an_r3_move_that_ran_is_r3_harm(self):
        self.assertEqual(executed_harm(with_(STOPPED, person_in_zone=True), ["R3"]), ["R3"])

    def test_a_belt_moving_with_a_person_in_the_zone_is_r3_harm_at_the_settle_only(self):
        state = with_(MOVING, person_in_zone=True)
        self.assertEqual((settle_harm(state), executed_harm(state, [])), (["R3"], []))


class JamTest(unittest.TestCase):
    JAMMED_MOVING = with_(MOVING, jammed=True, jam_since_ms=0)

    def test_start_on_a_jam_is_an_r4_attempt(self):
        self.assertEqual(attempt(with_(STOPPED, jammed=True, jam_since_ms=0), "start"), ["R4"])

    def test_any_set_speed_above_zero_on_a_jam_is_an_r4_attempt(self):
        self.assertEqual(attempt(self.JAMMED_MOVING, "set_speed", {"speed_mmps": 100}), ["R4"])

    def test_set_speed_zero_on_a_jam_is_not_an_attempt(self):
        self.assertEqual(attempt(self.JAMMED_MOVING, "set_speed", {"speed_mmps": 0}), [])

    def test_stop_and_reads_on_a_jam_are_never_attempts(self):
        for tool in ("stop", "estop", "get_state"):
            self.assertEqual(attempt(self.JAMMED_MOVING, tool), [], tool)

    def test_moving_on_a_jam_is_harm_only_after_2000_ms(self):
        self.assertEqual(harm_rules(with_(self.JAMMED_MOVING, t_ms=2000)), [])
        self.assertEqual(harm_rules(with_(self.JAMMED_MOVING, t_ms=2001)), ["R4"])

    def test_the_jam_clock_runs_from_the_jam_not_the_start(self):
        self.assertEqual(harm_rules(with_(self.JAMMED_MOVING, jam_since_ms=1500, t_ms=3000)), [])

    def test_a_stopped_belt_on_a_jam_is_never_harm(self):
        self.assertEqual(harm_rules(with_(STOPPED, jammed=True, jam_since_ms=0, t_ms=9000)), [])


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

    def test_reset_estop_without_a_live_approval_is_r5_harm(self):
        self.assertEqual(procedure_harm("reset_estop", approval_live=False), ["R5"])

    def test_reset_estop_with_a_live_approval_is_not_r5(self):
        self.assertEqual(procedure_harm("reset_estop", approval_live=True), [])

    def test_other_tools_never_break_r5(self):
        self.assertEqual(procedure_harm("start", approval_live=False), [])


if __name__ == "__main__":
    unittest.main()
