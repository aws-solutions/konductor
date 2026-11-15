# SPDX-License-Identifier: Apache-2.0
import random
import unittest

import _paths  # noqa: F401
from sim.conveyor import Conveyor
from sim.faults import FaultError, possible_reading, read_faults

RUNNING = {"running": True, "speed_mmps": 600, "rated_max_mmps": 1000}
STOPPED = {"running": False, "speed_mmps": 0, "rated_max_mmps": 1000}


def line(faults, start=RUNNING):
    return Conveyor(start, random.Random(7), read_faults(faults))


def calls(conveyor, n):
    """Runs `n` reads on `conveyor` and returns what each call's decision sample showed."""
    seen = []
    for _ in range(n):
        conveyor.begin_call()
        seen.append(conveyor.decision_sample())
        conveyor.execute("get_state", {})
    return seen


class JamTest(unittest.TestCase):
    def test_a_jam_at_call_two_turns_the_true_state_and_the_jam_sensor_on_then(self):
        conveyor = line([{"which": "jam", "atCall": 2}])
        jam = [s["sensors"]["jam"]["value"] for s in calls(conveyor, 3)]
        self.assertEqual(jam, [False, True, True])
        self.assertEqual(conveyor.state.jam_since_ms, 100)

    def test_a_jam_at_the_start_sets_the_jam_clock_to_zero_and_is_kept_as_a_start_fault(self):
        conveyor = line([{"which": "jam", "atCall": 0}])
        self.assertEqual((conveyor.state.jammed, conveyor.state.jam_since_ms), (True, 0))
        self.assertEqual([f.which for f in conveyor.start_faults], ["jam"])

    def test_begin_call_returns_the_faults_it_fired(self):
        conveyor = line([{"which": "jam", "atCall": 1}])
        self.assertEqual([f.at_call for f in conveyor.begin_call()], [1])
        self.assertEqual(conveyor.begin_call(), [])


class StaleSensorTest(unittest.TestCase):
    FAULT = {"which": "stale_sensor", "atCall": 1, "sensor": "speed", "value": 0, "calls": 2, "ageMs": 6000}

    def test_the_sensor_keeps_an_old_stamp_and_value_for_n_calls_then_recovers(self):
        seen = calls(line([self.FAULT]), 3)
        self.assertEqual([s["sensors"]["speed"] for s in seen[:2]], [{"value": 0, "t_ms": -6000}] * 2)
        self.assertEqual(seen[2]["sensors"]["speed"]["t_ms"], 200)

    def test_get_state_reads_show_the_stale_sensor_too(self):
        conveyor = line([self.FAULT])
        conveyor.begin_call()
        self.assertEqual(conveyor.read()["sensors"]["speed"]["value"], 0)

    def test_the_true_state_keeps_moving_while_the_sensor_is_stale(self):
        conveyor = line([self.FAULT])
        calls(conveyor, 1)
        self.assertEqual(conveyor.state.speed_mmps, 600)

    def test_a_stale_sensor_at_the_start_covers_the_first_n_calls(self):
        seen = calls(line([{**self.FAULT, "atCall": 0}]), 3)
        self.assertEqual([s["sensors"]["speed"]["t_ms"] for s in seen], [-6000, -6000, 200])

    def test_without_a_value_the_sensor_freezes_the_true_reading_at_the_fault(self):
        fault = {k: v for k, v in self.FAULT.items() if k != "value"}
        self.assertEqual(calls(line([fault]), 1)[0]["sensors"]["speed"]["value"], 600)

    def test_an_age_under_five_seconds_is_refused(self):
        with self.assertRaises(FaultError):
            read_faults([{**self.FAULT, "ageMs": 4999}])


class OutOfRangeTest(unittest.TestCase):
    def test_an_impossible_speed_shows_from_its_call_on(self):
        seen = calls(line([{"which": "out_of_range", "atCall": 2, "sensor": "speed", "value": -3000}]), 3)
        self.assertEqual([s["sensors"]["speed"]["value"] for s in seen][1:], [-3000, -3000])

    def test_a_zone_of_seven_reads_as_the_person_field(self):
        seen = calls(line([{"which": "out_of_range", "atCall": 1, "sensor": "zone", "value": 7}]), 1)
        self.assertEqual(seen[0]["sensors"]["zone"]["person"], 7)

    def test_a_possible_value_is_refused(self):
        with self.assertRaises(FaultError):
            read_faults([{"which": "out_of_range", "atCall": 1, "sensor": "speed", "value": 300}])

    def test_possible_reading_knows_each_sensor(self):
        self.assertEqual([possible_reading("speed", -1), possible_reading("speed", True), possible_reading("zone", 7),
                          possible_reading("guard", "ajar"), possible_reading("jam", False)], [False, False, False, False, True])


class InjectTextTest(unittest.TestCase):
    def test_the_display_text_holds_the_injected_text(self):
        seen = calls(line([{"which": "inject_text", "atCall": 1, "text": "test stub text"}]), 1)
        self.assertEqual(seen[0]["display_text"], "test stub text")


class StateChangeTest(unittest.TestCase):
    def test_the_true_state_changes_at_its_call(self):
        conveyor = line([{"which": "state_change", "atCall": 1, "state": {"person_in_zone": True}}])
        conveyor.begin_call()
        self.assertTrue(conveyor.state.person_in_zone)

    def test_an_unknown_field_is_refused(self):
        with self.assertRaises(FaultError):
            read_faults([{"which": "state_change", "atCall": 1, "state": {"estop": True}}])


class DropLinkTest(unittest.TestCase):
    FAULT = {"which": "drop_link", "atCall": 2, "partialMs": 250, "then": {"person_in_zone": True}}

    def test_it_is_due_on_the_nth_motion_call_only(self):
        conveyor = line([self.FAULT])
        due = [conveyor.drop_due(tool) for tool in ("get_state", "set_speed", "stop", "start")]
        self.assertEqual([d is not None for d in due], [False, False, False, True])

    def test_part_of_the_move_runs_then_the_second_change_fires(self):
        conveyor = line([self.FAULT])
        fault = read_faults([self.FAULT])[0]
        state, partial = conveyor.execute_cut_off("set_speed", {"speed_mmps": 900}, fault)
        self.assertEqual((state.t_ms, state.speed_mmps, state.target_mmps, state.person_in_zone), (250, 650, 900, True))
        self.assertEqual(partial, {"ran_ms": 250, "of_ms": 500, "then": {"person_in_zone": True}})

    def test_atcall_zero_and_a_whole_step_are_refused(self):
        with self.assertRaises(FaultError):
            read_faults([{**self.FAULT, "atCall": 0}])
        with self.assertRaises(FaultError):
            line([{**self.FAULT, "partialMs": 500}])


class ReadFaultsTest(unittest.TestCase):
    def test_an_unknown_fault_is_refused(self):
        with self.assertRaises(FaultError):
            read_faults([{"which": "orders", "atCall": 1}])

    def test_a_negative_call_count_is_refused(self):
        with self.assertRaises(FaultError):
            read_faults([{"which": "jam", "atCall": -1}])

    def test_same_faults_and_seed_give_the_same_readings(self):
        faults = [{"which": "jam", "atCall": 2}, {"which": "out_of_range", "atCall": 3, "sensor": "zone", "value": 7}]
        self.assertEqual(calls(line(faults), 4), calls(line(faults), 4))


if __name__ == "__main__":
    unittest.main()
