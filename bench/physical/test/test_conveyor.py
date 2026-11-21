# SPDX-License-Identifier: Apache-2.0
import random
import unittest

import _paths  # noqa: F401
from sim.conveyor import NOT_EXECUTED_MS, SETTLE_MS, TICK_MS, Conveyor, state_from_start

RUNNING = {"running": True, "speed_mmps": 600, "rated_max_mmps": 1000}
STOPPED = {"running": False, "speed_mmps": 0, "rated_max_mmps": 1000}


def line(start=RUNNING, seed=7):
    return Conveyor(start, random.Random(seed))


class TrueStateTest(unittest.TestCase):
    def test_a_jammed_start_sets_the_jam_clock_to_zero(self):
        self.assertEqual(state_from_start({**RUNNING, "jammed": True}).jam_since_ms, 0)

    def test_an_estop_start_begins_with_the_latch_set(self):
        from sim.conveyor import state_from_start
        self.assertTrue(state_from_start({"rated_max_mmps": 1000, "estop": True}).estop)
        self.assertFalse(state_from_start({"rated_max_mmps": 1000}).estop)

    def test_a_clear_start_has_no_jam_clock(self):
        self.assertIsNone(state_from_start(RUNNING).jam_since_ms)


class ToolEffectsTest(unittest.TestCase):
    def test_set_speed_ramps_toward_the_target_at_200_mmps_per_second(self):
        after = line().execute("set_speed", {"speed_mmps": 900})
        self.assertEqual((after.target_mmps, after.speed_mmps, after.t_ms), (900, 700, 500))

    def test_stop_reaches_speed_zero_inside_its_own_step(self):
        after = line().execute("stop", {})
        self.assertEqual((after.running, after.speed_mmps, after.t_ms), (False, 0, 500))

    def test_stop_keeps_the_target(self):
        self.assertEqual(line().execute("stop", {}).target_mmps, 600)

    def test_estop_latches_and_stops_at_once(self):
        after = line().execute("estop", {})
        self.assertEqual((after.estop, after.running, after.speed_mmps), (True, False, 0))

    def test_start_does_nothing_while_the_estop_is_latched(self):
        conveyor = line(STOPPED)
        conveyor.execute("estop", {})
        self.assertFalse(conveyor.execute("start", {}).running)

    def test_reset_estop_clears_the_latch_and_leaves_the_belt_stopped(self):
        conveyor = line(STOPPED)
        conveyor.execute("estop", {})
        after = conveyor.execute("reset_estop", {})
        self.assertEqual((after.estop, after.running, after.speed_mmps), (False, False, 0))

    def test_start_runs_again_after_the_estop_is_reset(self):
        conveyor = line(STOPPED)
        conveyor.execute("estop", {})
        conveyor.execute("reset_estop", {})
        self.assertTrue(conveyor.execute("start", {}).running)

    def test_start_ramps_up_from_the_current_speed(self):
        conveyor = line(STOPPED)
        conveyor.execute("set_speed", {"speed_mmps": 400})
        self.assertEqual(conveyor.execute("start", {}).speed_mmps, 100)

    def test_open_guard_opens_and_the_belt_keeps_its_speed(self):
        after = line().execute("open_guard", {})
        self.assertEqual((after.guard, after.speed_mmps), ("open", 600))

    def test_reads_cost_100_ms(self):
        self.assertEqual(line().execute("get_state", {}).t_ms, 100)

    def test_a_call_that_did_not_execute_costs_100_ms_and_changes_nothing_else(self):
        conveyor = line()
        before = conveyor.state
        after = conveyor.skip()
        self.assertEqual(after.t_ms, NOT_EXECUTED_MS)
        self.assertEqual({**after.to_dict(), "t_ms": 0}, before.to_dict())

    def test_preview_leaves_the_live_state_alone(self):
        conveyor = line()
        conveyor.preview("open_guard", {})
        self.assertEqual(conveyor.state.guard, "closed")


class SensorViewTest(unittest.TestCase):
    def test_a_stopped_belt_always_reads_zero(self):
        conveyor = line(STOPPED)
        self.assertTrue(all(conveyor.read()["sensors"]["speed"]["value"] == 0 for _ in range(50)))

    def test_noise_stays_within_five_mmps_of_the_true_speed(self):
        readings = [line(seed=s).decision_sample()["sensors"]["speed"]["value"] for s in range(50)]
        self.assertTrue(all(595 <= r <= 605 for r in readings))

    def test_each_read_gets_the_next_read_id(self):
        conveyor = line()
        self.assertEqual([conveyor.read()["read_id"] for _ in range(3)], ["r1", "r2", "r3"])

    def test_sensor_stamps_follow_sim_time(self):
        conveyor = line()
        conveyor.execute("stop", {})
        self.assertEqual(conveyor.read()["sensors"]["guard"]["t_ms"], 500)


class DeterminismTest(unittest.TestCase):
    CALLS = [("get_state", {}), ("set_speed", {"speed_mmps": 800}), ("get_state", {}), ("stop", {})]

    def trace(self, seed):
        conveyor = line(seed=seed)
        return [(conveyor.execute(tool, args).to_dict(), conveyor.view) for tool, args in self.CALLS]

    def test_same_seed_and_calls_give_the_same_states_and_readings(self):
        self.assertEqual(self.trace(3), self.trace(3))

    def test_another_seed_changes_only_the_readings(self):
        a, b = self.trace(3), self.trace(4)
        self.assertEqual([s for s, _ in a], [s for s, _ in b])
        self.assertNotEqual([v for _, v in a], [v for _, v in b])


class SettleTest(unittest.TestCase):
    def test_settle_runs_ten_seconds_in_half_second_ticks(self):
        ticks = list(line().settle())
        self.assertEqual(len(ticks), SETTLE_MS // TICK_MS)
        self.assertEqual(ticks[-1].t_ms, SETTLE_MS)

    def test_a_running_belt_keeps_moving_through_the_settle(self):
        self.assertTrue(all(state.moving for state in line().settle()))


if __name__ == "__main__":
    unittest.main()
