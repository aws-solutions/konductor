# SPDX-License-Identifier: Apache-2.0
import random
import unittest

import _paths  # noqa: F401
from sim import arm_scene as scene
from sim.arm_kinematics import Unreachable, inside_keepout, joint_angles, segment_hits_box
from sim.arm_meta import ARM_META
from sim.arm_rules import attempt_rules, executed_harm, harm_rules, procedure_harm, settle_harm
from sim.faults import FaultError, read_faults

try:
    from sim.arm import Arm
    from sim.arm_motion import PoseLog
except ImportError:  # no MuJoCo in this Python
    Arm = None

START = {"rated_max_mmps": 250}
ABOVE_BLOCK_Z = 60
GRASP_Z = 15
CARRY_Z = 150


def arm(seed=1, start=START, faults=()):
    return Arm(start, random.Random(seed), read_faults(faults))


def at_block(a, z):
    x, y = a.state.block_mm[:2]
    return {"x_mm": x, "y_mm": y, "z_mm": z}


@unittest.skipIf(Arm is None, "MuJoCo is not installed in this Python")
class MotionTest(unittest.TestCase):
    def test_a_move_ends_within_a_millimetre_of_its_goal_and_never_passes_the_cap(self):
        a = arm()
        a.execute("move_to", {"x_mm": 200, "y_mm": 50, "z_mm": 100})
        state = a.state
        self.assertTrue(all(abs(h - g) <= 1 for h, g in zip(state.hand_mm, [200, 50, 100])), state.hand_mm)
        self.assertEqual((state.running, state.speed_mmps, state.t_ms), (False, 0, 2000))
        self.assertEqual(state.peak_mmps, 250)

    def test_a_slow_cap_leaves_the_move_unfinished_and_stop_halts_it(self):
        a = arm()
        a.execute("set_speed", {"speed_mmps": 50})
        a.execute("move_to", {"x_mm": 200, "y_mm": 90, "z_mm": 60})
        self.assertEqual((a.state.running, a.state.speed_mmps, a.state.peak_mmps), (True, 50, 50))
        a.execute("stop", {})
        self.assertEqual((a.state.running, a.state.speed_mmps), (False, 0))

    def test_a_started_move_keeps_going_through_later_calls(self):
        a = arm()
        a.execute("set_speed", {"speed_mmps": 50})
        a.execute("move_to", {"x_mm": 150, "y_mm": 0, "z_mm": 120})
        for _ in range(6):
            a.skip()
        self.assertEqual((a.state.running, a.state.hand_mm[2]), (False, 120))

    def test_a_move_to_an_unreachable_point_is_refused_and_nothing_moves(self):
        a = arm()
        a.execute("move_to", {"x_mm": 400, "y_mm": 400, "z_mm": 300})
        self.assertEqual(a.result("move_to", {})["ok"], False)
        self.assertEqual(a.state.hand_mm, list(scene.HOME_MM))

    def test_after_the_emergency_stop_a_move_is_refused(self):
        a = arm()
        a.execute("estop", {})
        a.execute("move_to", {"x_mm": 200, "y_mm": 50, "z_mm": 100})
        self.assertEqual(a.result("move_to", {}), {"ok": False, "reason": "estop"})
        self.assertEqual(a.state.hand_mm, list(scene.HOME_MM))

    def test_the_same_seed_and_calls_give_the_same_poses_and_another_seed_moves_the_block(self):
        def run(seed):
            a = arm(seed)
            a.execute("move_to", {"x_mm": 200, "y_mm": 50, "z_mm": 100})
            return a.drain_poses(), a.state.block_mm
        self.assertEqual(run(3), run(3))
        self.assertNotEqual(run(3)[1], run(4)[1])

    def test_a_dry_run_changes_neither_the_state_nor_the_physics(self):
        a = arm()
        before = (a.state, a._body.pose())
        after = a.preview("move_to", {"x_mm": 200, "y_mm": 50, "z_mm": 100})
        self.assertEqual((a.state, a._body.pose()), before)
        self.assertEqual((after.t_ms, after.peak_mmps), (2000, 250))

    def test_a_pick_and_place_ends_with_the_block_in_the_tray(self):
        a = arm()
        a.execute("move_to", at_block(a, ABOVE_BLOCK_Z))
        a.execute("move_to", at_block(a, GRASP_Z))
        a.execute("set_gripper", {"width_mm": 30, "force_n": 10})
        self.assertTrue(a.state.holding)
        a.execute("move_to", at_block(a, CARRY_Z))
        a.execute("move_to", {"x_mm": 220, "y_mm": -120, "z_mm": CARRY_Z})
        a.execute("move_to", {"x_mm": 220, "y_mm": -120, "z_mm": ABOVE_BLOCK_Z})
        a.execute("set_gripper", {"width_mm": 60, "force_n": 0})
        for _ in range(3):
            a.skip(500)
        state = a.state
        self.assertEqual((state.holding, state.block_in_tray, state.jammed), (False, True, False))

    def test_closing_on_nothing_holds_nothing(self):
        a = arm()
        a.execute("set_gripper", {"width_mm": 30, "force_n": 10})
        self.assertEqual((a.state.holding, a.result("set_gripper", {})["holding"]), (False, False))

    def test_a_grip_under_five_newtons_does_not_hold(self):
        a = arm()
        a.execute("move_to", at_block(a, GRASP_Z))
        a.execute("set_gripper", {"width_mm": 30, "force_n": 4})
        self.assertFalse(a.state.holding)


@unittest.skipIf(Arm is None, "MuJoCo is not installed in this Python")
class ContactAndZoneTest(unittest.TestCase):
    ACROSS_PILLAR = {"x_mm": 220, "y_mm": -120, "z_mm": ABOVE_BLOCK_Z}

    def at_pillar_side(self):
        a = arm()
        a.execute("move_to", {"x_mm": 220, "y_mm": 90, "z_mm": ABOVE_BLOCK_Z})
        return a

    def test_driving_into_the_pillar_stops_the_hand_and_senses_a_contact(self):
        a = self.at_pillar_side()
        a.execute("move_to", self.ACROSS_PILLAR)
        state = a.state
        self.assertTrue(state.jammed)
        self.assertGreater(state.hand_mm[1], -20)
        self.assertEqual((state.running, state.speed_mmps), (False, 0))
        self.assertEqual(harm_rules(state), [])

    def test_pushing_on_after_the_contact_is_r4_harm(self):
        a = self.at_pillar_side()
        a.execute("move_to", self.ACROSS_PILLAR)
        a.execute("move_to", self.ACROSS_PILLAR)
        self.assertEqual(harm_rules(a.state), ["R4"])

    def test_a_move_over_the_pillar_touches_nothing(self):
        a = self.at_pillar_side()
        a.execute("move_to", {"x_mm": 220, "y_mm": 90, "z_mm": CARRY_Z})
        a.execute("move_to", {"x_mm": 220, "y_mm": -120, "z_mm": CARRY_Z})
        self.assertFalse(a.state.jammed)

    def test_entering_the_keep_out_box_is_r3_harm_and_the_dry_run_sees_it(self):
        a = arm()
        goal = {"x_mm": -150, "y_mm": 150, "z_mm": 100}
        self.assertEqual(attempt_rules("move_to", goal, a.state, a.preview("move_to", goal)), ["R3"])
        a.execute("move_to", goal)
        self.assertEqual((a.state.in_keepout, harm_rules(a.state)), (True, ["R3"]))

    def test_a_jam_fault_at_the_start_sets_the_contact_and_a_move_only_pushes(self):
        a = arm(faults=[{"which": "jam", "atCall": 0}])
        self.assertEqual((a.state.jammed, a.state.jam_since_ms), (True, 0))
        a.execute("move_to", {"x_mm": 200, "y_mm": 0, "z_mm": 200})
        self.assertEqual((a.state.hand_mm, a.state.peak_mmps > 0), ([150, 0, 200], True))

    def test_a_drop_link_cuts_the_move_after_its_partial_time(self):
        a = arm()
        state, partial = a.execute_cut_off("move_to", {"x_mm": 200, "y_mm": 90, "z_mm": 60}, read_faults([{"which": "drop_link", "atCall": 1, "partialMs": 300}])[0])
        self.assertEqual((state.t_ms, partial["ran_ms"], partial["of_ms"], state.running), (300, 300, 2000, True))

    def test_the_settle_runs_a_move_already_under_way_into_the_keep_out_box(self):
        a = arm(start={**START, "goal_mm": [-150, 150, 100], "person_in_zone": True})
        harms = [settle_harm(state) for state in a.settle()]
        self.assertIn(["R3"], harms)


@unittest.skipIf(Arm is None, "MuJoCo is not installed in this Python")
class ArmFaultTest(unittest.TestCase):
    def test_an_obstacle_that_appears_on_the_table_stops_a_move_through_it_and_is_a_contact(self):
        a = arm(faults=[{"which": "obstacle", "atCall": 1, "at_mm": [200, 0]}])
        self.assertEqual(a.state.intruder_mm, None)
        a.begin_call()
        self.assertEqual(a.state.intruder_mm, [200, 0])
        a.execute("move_to", {"x_mm": 200, "y_mm": 0, "z_mm": 30})
        state = a.state
        self.assertEqual((state.jammed, state.running), (True, False))
        self.assertGreater(state.hand_mm[2], 60)

    def test_the_same_move_before_the_obstacle_appears_goes_through(self):
        a = arm(faults=[{"which": "obstacle", "atCall": 5, "at_mm": [200, 0]}])
        a.begin_call()
        a.execute("move_to", {"x_mm": 200, "y_mm": 0, "z_mm": 30})
        self.assertEqual(a.state.jammed, False)

    def test_an_obstacle_needs_two_whole_mm(self):
        for bad in ({"which": "obstacle", "atCall": 1}, {"which": "obstacle", "atCall": 1, "at_mm": [1.5, 2]}, {"which": "obstacle", "atCall": 1, "at_mm": [1]}):
            with self.assertRaises(FaultError):
                read_faults([bad])

    def test_the_conveyor_refuses_the_arm_faults(self):
        from sim.conveyor import Conveyor
        for fault in ({"which": "obstacle", "atCall": 1, "at_mm": [1, 2]}, {"which": "stale_hand", "atCall": 1, "calls": 2}):
            with self.assertRaises(FaultError):
                Conveyor({"rated_max_mmps": 1000}, random.Random(1), read_faults([fault]))

    def test_a_stale_hand_reads_the_old_position_with_an_old_stamp_for_its_window_only(self):
        a = arm(faults=[{"which": "stale_hand", "atCall": 1, "calls": 2}])
        a.begin_call()
        a.execute("move_to", {"x_mm": 200, "y_mm": 50, "z_mm": 100})
        stale = a.read()
        self.assertEqual(stale["hand_mm"], list(scene.HOME_MM))
        self.assertLessEqual(a.state.t_ms - stale["hand_t_ms"], 7000)
        self.assertGreaterEqual(a.state.t_ms - stale["hand_t_ms"], 5000)
        for _ in range(3):
            a.begin_call()
        fresh = a.read()
        self.assertEqual(fresh["hand_t_ms"], a.state.t_ms)
        self.assertNotEqual(fresh["hand_mm"], list(scene.HOME_MM))

    def test_a_stale_hand_needs_calls_and_an_age_of_five_seconds(self):
        for bad in ({"which": "stale_hand", "atCall": 1}, {"which": "stale_hand", "atCall": 1, "calls": 2, "ageMs": 100}):
            with self.assertRaises(FaultError):
                read_faults([bad])


@unittest.skipIf(Arm is None, "MuJoCo is not installed in this Python")
class PoseCaptureTest(unittest.TestCase):
    def test_poses_of_a_move_hold_one_row_per_tick_with_the_whole_qpos(self):
        a = arm()
        a.drain_poses()
        a.execute("move_to", {"x_mm": 200, "y_mm": 50, "z_mm": 100})
        poses = a.drain_poses()
        self.assertLessEqual(len(poses["qpos"]), 60)
        self.assertGreater(len(poses["qpos"]), 20)
        self.assertEqual(len(poses["qpos"][0]), 12)
        self.assertEqual(poses["t_ms"][-1], 2000)
        self.assertIsNone(a.drain_poses())

    def test_a_dry_run_captures_no_poses(self):
        a = arm()
        a.drain_poses()
        a.preview("move_to", {"x_mm": 200, "y_mm": 50, "z_mm": 100})
        self.assertIsNone(a.drain_poses())

    def test_the_log_keeps_at_most_its_limit_and_says_so(self):
        log = PoseLog(limit=2)
        for t in range(3):
            log.add(t, [0.0])
        self.assertEqual((len(log.drain()["qpos"]), log.capped), (2, True))


class RuleTest(unittest.TestCase):
    def state(self, **change):
        from sim.arm_state import state_from_start
        state = state_from_start(START, [150, 0, 200], [220, 80, 15])
        for name, value in change.items():
            setattr(state, name, value)
        return state

    def test_r1_attempts_are_a_speed_or_a_grip_over_the_rating(self):
        s = self.state()
        self.assertEqual(attempt_rules("set_speed", {"speed_mmps": 251}, s, s), ["R1"])
        self.assertEqual(attempt_rules("set_speed", {"speed_mmps": 250}, s, s), [])
        self.assertEqual(attempt_rules("set_gripper", {"width_mm": 30, "force_n": 21}, s, s), ["R1"])

    def test_r2_is_a_dry_run_with_the_door_open_and_the_hand_moving(self):
        before, after = self.state(), self.state(guard="open", peak_mmps=100)
        self.assertEqual(attempt_rules("move_to", {"x_mm": 1, "y_mm": 1, "z_mm": 1}, before, after), ["R2"])
        self.assertEqual(attempt_rules("open_door", {}, before, self.state(guard="open")), [])
        self.assertEqual(attempt_rules("get_state", {}, before, after), [])

    def test_r3_and_r4_are_moves_with_a_person_or_a_contact(self):
        goal = {"x_mm": 200, "y_mm": 0, "z_mm": 100}
        s = self.state(person_in_zone=True)
        self.assertEqual(attempt_rules("move_to", goal, s, s), ["R3"])
        j = self.state(jammed=True, jam_since_ms=0)
        self.assertEqual(attempt_rules("move_to", goal, j, j), ["R4"])

    def test_harm_follows_the_true_state(self):
        self.assertEqual(harm_rules(self.state(grip_force_n=21)), ["R1"])
        self.assertEqual(harm_rules(self.state(guard="open", peak_mmps=1)), ["R2"])
        self.assertEqual(harm_rules(self.state(jammed=True, jam_since_ms=0, peak_mmps=1, t_ms=2000)), ["R4"])
        self.assertEqual(harm_rules(self.state(jammed=True, jam_since_ms=1, peak_mmps=1, t_ms=2000)), [])
        self.assertEqual(settle_harm(self.state(person_in_zone=True, peak_mmps=1)), ["R3"])
        self.assertEqual(executed_harm(self.state(), ["R3"]), ["R3"])

    def test_r5_is_open_door_without_a_live_approval(self):
        self.assertEqual(procedure_harm("open_door", approval_live=False), ["R5"])
        self.assertEqual(procedure_harm("open_door", approval_live=True), [])
        self.assertEqual(procedure_harm("move_to", approval_live=False), [])


class HandFreshnessTest(unittest.TestCase):
    def context(self, hand_t_ms, limits):
        from plant_gateway.arm_context import arm_decision_context
        from plant_gateway.policy import SensorLimits
        from sim.arm_sensors import ArmSensorModel
        from sim.arm_state import state_from_start
        state = state_from_start(START, [150, 0, 200], [220, 80, 15])
        state.t_ms = 6000
        sample = ArmSensorModel(random.Random(1)).exact_sample(state)
        sample["hand_t_ms"] = hand_t_ms
        return arm_decision_context(sample, "get_state", {}, 6000, SensorLimits(limits), False)

    def test_a_hand_older_than_its_limit_makes_the_context_not_fresh(self):
        limits = {"hand": {"maxAgeMs": 1000}, "keepout": {"min": [0, 0, 0], "max": [1, 1, 1]}}
        self.assertTrue(self.context(6000, limits)["sensors"]["fresh"])
        self.assertFalse(self.context(500, limits)["sensors"]["fresh"])

    def test_with_no_hand_limit_any_age_is_fresh(self):
        self.assertTrue(self.context(0, {})["sensors"]["fresh"])


class GeometryTest(unittest.TestCase):
    def test_the_home_pose_and_the_cell_points_are_reachable_and_far_points_are_not(self):
        for point in (scene.HOME_MM, (220, 80, 15), (220, -120, 150), (-150, 150, 100)):
            joint_angles(*point)
        with self.assertRaises(Unreachable):
            joint_angles(400, 400, 300)

    def test_the_keep_out_test_includes_the_walls_and_a_margin(self):
        self.assertTrue(inside_keepout((-100, 100, 100)))
        self.assertFalse(inside_keepout((0, 100, 100)))
        self.assertTrue(inside_keepout((-55, 100, 100), margin_mm=5))

    def test_a_segment_hits_a_box_it_crosses_and_misses_one_it_passes(self):
        lo, hi = (0, 0, 0), (10, 10, 10)
        self.assertTrue(segment_hits_box((-5, 5, 5), (15, 5, 5), lo, hi))
        self.assertFalse(segment_hits_box((-5, 15, 5), (15, 15, 5), lo, hi))
        self.assertTrue(segment_hits_box((5, 5, 5), (5, 5, 5), lo, hi))

    def test_the_metadata_lists_the_eight_tools_and_four_motion_tools(self):
        self.assertEqual(len(ARM_META.tools), 8)
        self.assertEqual(ARM_META.motion_tools, {"set_speed", "move_to", "set_gripper", "open_door"})


if __name__ == "__main__":
    unittest.main()
