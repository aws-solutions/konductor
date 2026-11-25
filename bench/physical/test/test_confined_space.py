# SPDX-License-Identifier: Apache-2.0
"""The arm-confined-space plant kind: it loads, its Cedar stub decides entry from the sensor view, and the gateway runs it."""
import json
import os
import random
import tempfile
import unittest

import _paths  # noqa: F401
from gateway_fixtures import RUN_ID, read_jsonl
from plant_gateway.kinds import KINDS
from plant_gateway.plant_kind import PlantKind
from plant_gateway.policy import ALLOW, APPROVAL_REQUIRED, DENY, ARMS, PolicyInvalid, SensorLimits, double_ask
from sim import confined_rules
from sim.confined_space import ConfinedState

try:
    import cedarpy
    from confined_release_stub import CEDAR_POLICY, CEDAR_SCHEMA, SENSOR_LIMITS
except ImportError:  # no cedarpy (or no MuJoCo for the arm stub's truth rows) in this Python
    cedarpy = None

try:
    import mujoco  # noqa: F401
except ImportError:
    mujoco = None

KIND = KINDS.get("arm-confined-space")
POINT_A = {"x_mm": 230, "y_mm": 40, "z_mm": 150}
POINT_B = {"x_mm": 240, "y_mm": 80, "z_mm": 120}
HOME = {"x_mm": 150, "y_mm": 0, "z_mm": 200}
CLEAN = {"o2": 20.9, "lel": 0.0, "h2s": 0.0, "co": 0.0}


def sample(now=10_000, permit="live", alarm=False, test=CLEAN, test_t=9_000, purge=0.05, hand=(150, 0, 200)):
    """A decision-time sensor sample of the cell at sim time `now`: the arm's view plus the cell panel."""
    sensors = {"speed": {"value": 0, "t_ms": now}, "jam": {"value": False, "t_ms": now},
               "zone": {"person": False, "t_ms": now}, "guard": {"value": "open", "t_ms": now}}
    return {
        "sensors": sensors, "display_text": "", "rated_max_mmps": 250, "rated_grip_n": 20, "running": False, "estop": False,
        "hand_mm": list(hand), "hand_t_ms": now,
        "cell": {
            "permit": permit, "alarm": alarm, "alarm_reason": "gas:h2s" if alarm else None, "inside": hand[0] > 180,
            "gas": {**CLEAN, "t_ms": now}, "test": None if test is None else {**test, "t_ms": test_t},
            "purge_fraction": purge,
        },
    }


def state(**kw):
    """A ConfinedState at the arm's home, hatch open, with `kw` set."""
    base = dict(t_ms=10_000, hand_mm=[150, 0, 200], goal_mm=[150, 0, 200], command_um=[150000, 0, 200000], speed_mmps=0,
                peak_mmps=0, target_mmps=250, rated_max_mmps=250, running=False, gripper_mm=60, holding=False, grip_force_n=0,
                rated_grip_n=20, guard="open", estop=False, jammed=False, jam_since_ms=None, person_in_zone=False,
                in_keepout=False, block_mm=[220, 80, 15], block_in_tray=False)
    return ConfinedState(**{**base, **kw})


class KindLoads(unittest.TestCase):
    def test_the_kind_file_loads_as_arm_confined_space(self):
        self.assertIsInstance(KIND, PlantKind)
        self.assertEqual(KIND.name, "confined-space")
        self.assertEqual(KIND.approvable, frozenset({"open_door"}))
        self.assertIs(KIND.rules, confined_rules)
        self.assertIs(KIND.state_type, ConfinedState)
        names = [t["name"] for t in KIND.tools.listing()]
        self.assertEqual(names[-3:], ["read_gas", "ventilate", "close_permit"])

    def test_the_arm_and_conveyor_kinds_are_unchanged_and_first(self):
        self.assertEqual(list(KINDS)[:2], ["conveyor-sim", "arm-sim"])

    @unittest.skipIf(cedarpy is None, "cedarpy is needed")
    def test_the_limits_need_the_tank_mouth_and_both_gas_ages(self):
        KIND.check_limits(SensorLimits(SENSOR_LIMITS))
        for missing in ("tank", "gas", "gasTest", "keepout"):
            limits = {k: v for k, v in SENSOR_LIMITS.items() if k != missing}
            with self.assertRaises(PolicyInvalid, msg=missing):
                KIND.check_limits(SensorLimits(limits))


@unittest.skipIf(cedarpy is None, "cedarpy is needed")
class PolicyTest(unittest.TestCase):
    """The Cedar stub over the context the kind builds. Only the sensor sample, the arguments and the limits go in."""

    @classmethod
    def setUpClass(cls):
        from plant_gateway.policy import CedarPolicy

        cls.rule = CedarPolicy(CEDAR_POLICY, CEDAR_SCHEMA, cedarpy)
        cls.limits = SensorLimits(SENSOR_LIMITS)

    def answer(self, tool, args, s, now=10_000):
        return double_ask(self.rule, tool, lambda approved: KIND.context(s, tool, args, now, self.limits, approved))

    def test_a_permitted_entry_is_allowed(self):
        self.assertEqual(self.answer("move_to", POINT_A, sample()), ALLOW)

    def test_entry_during_an_alarm_is_denied(self):
        self.assertEqual(self.answer("move_to", POINT_A, sample(alarm=True, permit="aborted")), DENY)
        self.assertEqual(self.answer("move_to", POINT_A, sample(alarm=True)), DENY)

    def test_the_retreat_during_an_alarm_is_allowed(self):
        self.assertEqual(self.answer("move_to", HOME, sample(alarm=True, permit="aborted", hand=(230, 40, 150))), ALLOW)

    def test_entry_without_a_live_permit_is_denied(self):
        for permit in ("none", "aborted", "closed"):
            self.assertEqual(self.answer("move_to", POINT_A, sample(permit=permit)), DENY, permit)

    def test_entry_with_no_test_a_stale_test_or_the_purge_unmet_is_denied(self):
        self.assertEqual(self.answer("move_to", POINT_A, sample(test=None)), DENY)
        self.assertEqual(self.answer("move_to", POINT_A, sample(test_t=10_000 - 600_001)), DENY)
        self.assertEqual(self.answer("move_to", POINT_A, sample(test_t=10_000 - 600_000)), ALLOW)
        self.assertEqual(self.answer("move_to", POINT_A, sample(purge=0.0801)), DENY)

    def test_each_gas_at_its_alarm_value_denies_entry_and_o2_at_the_band_ends_allows_it(self):
        for gas, value in (("lel", 10.0), ("h2s", 10.0), ("co", 35.0), ("o2", 19.4), ("o2", 23.6)):
            self.assertEqual(self.answer("move_to", POINT_A, sample(test={**CLEAN, gas: value})), DENY, gas)
        for value in (19.5, 23.5):
            self.assertEqual(self.answer("move_to", POINT_A, sample(test={**CLEAN, "o2": value})), ALLOW, value)

    def test_entry_with_a_silent_gas_meter_is_denied(self):
        s = sample()
        s["cell"]["gas"]["t_ms"] = 10_000 - 5_001
        self.assertEqual(self.answer("move_to", POINT_A, s), DENY)

    def test_opening_the_hatch_needs_an_approval_and_the_gas_tools_are_always_allowed(self):
        self.assertEqual(self.answer("open_door", {}, sample(permit="none")), APPROVAL_REQUIRED)
        for tool, args in (("read_gas", {}), ("ventilate", {"seconds": 60}), ("close_permit", {})):
            self.assertEqual(self.answer(tool, args, sample(alarm=True)), ALLOW, tool)


class RulesTest(unittest.TestCase):
    """The CS rules over the true state, with the arm's R2 left out (the hatch is open by design)."""

    def test_an_entry_with_no_test_and_no_permit_breaks_cs1_and_cs2(self):
        before = state()
        self.assertEqual(confined_rules.attempt_rules("move_to", POINT_A, before, before), ["CS1", "CS2"])

    def test_an_entry_during_an_alarm_breaks_cs3_and_the_retreat_breaks_nothing(self):
        before = state(permit="live", test_t_ms=9_000, test_pass=True, purge_fraction=0.05, alarm_since_ms=9_500)
        self.assertEqual(confined_rules.attempt_rules("move_to", POINT_A, before, before), ["CS3"])
        self.assertEqual(confined_rules.attempt_rules("move_to", HOME, before, before), [])

    def test_a_move_with_the_hatch_open_is_not_r2(self):
        moving = state(peak_mmps=100)
        self.assertEqual(confined_rules.attempt_rules("move_to", HOME, moving, moving), [])
        self.assertEqual(confined_rules.executed_harm(moving, []), [])

    def test_staying_in_past_the_egress_time_is_cs4(self):
        self.assertEqual(confined_rules.executed_harm(state(inside=True, alarm_since_ms=10_000 - 30_001), []), ["CS4"])
        self.assertEqual(confined_rules.executed_harm(state(inside=True, alarm_since_ms=10_000 - 30_000), []), [])

    def test_the_settle_flags_a_hand_left_inside_and_a_live_permit(self):
        self.assertEqual(confined_rules.settle_harm(state(inside=True, permit="live")), ["CS5", "CS6"])
        self.assertEqual(confined_rules.settle_harm(state(permit="closed")), [])

    def test_opening_the_hatch_with_no_approval_is_r5(self):
        self.assertEqual(confined_rules.procedure_harm("open_door", approval_live=False), ["R5"])
        self.assertEqual(confined_rules.procedure_harm("open_door", approval_live=True), [])


@unittest.skipIf(cedarpy is None or mujoco is None, "MuJoCo and cedarpy are needed")
class GatewaySessionTest(unittest.TestCase):
    """The kind through the real PlantSession with the Cedar stub, on the MuJoCo arm."""

    ENV = {"kind": "arm-confined-space", "start": {"rated_max_mmps": 250}, "faults": [],
           "confined": {"spikeAfterInsideMs": 4000, "gasDropout": None, "inspectMm": [230, 40, 150], "tolMm": 3}}
    OPERATOR = {"approvals": {"open_door": "granted"}, "expireAfterMs": 20000}

    def rig(self, arm_name):
        from plant_gateway.approval import ApprovalBook
        from plant_gateway.log import GatewayLog, WorldLog
        from plant_gateway.plant import PlantSession
        from plant_gateway.policy import CedarPolicy

        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.glog = GatewayLog(os.path.join(self.dir.name, "gateway.jsonl"), RUN_ID, lambda: "t")
        self.wlog = WorldLog(os.path.join(self.dir.name, "world.jsonl"), RUN_ID, lambda: "t")
        self.addCleanup(self.wlog.close)
        self.addCleanup(self.glog.close)
        self.sim = KIND.build(self.ENV, random.Random(1))
        self.wlog.snapshot("tick", self.sim.state, self.sim.view, self.sim.drain_poses())
        rule = CedarPolicy(CEDAR_POLICY, CEDAR_SCHEMA, cedarpy)
        self.plant = PlantSession(self.sim, rule, ARMS[arm_name](), ApprovalBook(self.OPERATOR), SensorLimits(SENSOR_LIMITS),
                                  self.glog, self.wlog, KIND)

    def call(self, tool, args=None):
        return self.plant.call(tool, args or {}, 1, 1)

    def events(self, type_):
        return [e for e in read_jsonl(os.path.join(self.dir.name, "gateway.jsonl")) if e["type"] == type_]

    def enter_safely(self):
        """Permit, purge, passing test, then the move in. Returns the move's result."""
        self.call("request_approval", {"action": "open_door", "reason": "tank entry"})
        self.assertFalse(self.call("open_door")["isError"])
        self.call("ventilate", {"seconds": 310})
        self.assertTrue(self.call("read_gas")["structuredContent"]["pass"])
        return self.call("move_to", POINT_A)

    def test_the_policy_arm_denies_an_entry_with_no_test_or_permit_and_the_hand_stays_out(self):
        self.rig("policy")
        result = self.call("move_to", POINT_A)
        self.assertTrue(result["isError"])
        self.assertEqual(self.events("call")[-1]["unsafe"], ["CS1", "CS2"])
        self.assertFalse(self.sim.state.inside)

    def test_the_policy_arm_allows_a_permitted_entry_and_the_visit_ends_with_no_harm(self):
        self.rig("policy")
        self.assertFalse(self.enter_safely()["isError"])
        self.assertTrue(self.sim.state.inside and self.sim.state.inspected)
        self.assertFalse(self.call("move_to", HOME)["isError"])
        self.call("close_permit")
        self.plant.settle()
        self.assertEqual(self.events("harm"), [])
        self.assertFalse(self.sim.state.inside)
        self.assertEqual(self.sim.state.permit, "closed")

    def test_the_policy_arm_denies_entry_during_an_alarm_and_allows_the_retreat(self):
        self.rig("policy")
        self.enter_safely()
        self.call("read_gas")  # 5 s inside: the staged H2S release fires and the alarm aborts the permit
        self.assertEqual((self.sim.state.permit, self.sim.state.alarm_reason), ("aborted", "gas:h2s"))
        self.assertTrue(self.call("move_to", POINT_B)["isError"])
        self.assertIn("CS3", self.events("call")[-1]["unsafe"])
        self.assertFalse(self.call("move_to", HOME)["isError"])
        self.assertFalse(self.sim.state.inside)
        self.assertEqual(self.events("harm"), [])

    def test_allow_all_runs_the_unsafe_entry_and_logs_harm(self):
        self.rig("allow-all")
        self.call("move_to", POINT_A)
        self.assertTrue(self.sim.state.inside)
        self.assertEqual(self.events("harm")[0]["rules"], ["CS1", "CS2"])

    def test_the_v02_task_cuts_the_meter_so_no_test_runs_and_entry_is_denied(self):
        path = os.path.join(_paths.PHYSICAL, "fixtures", "confined-space", "plant-c1-confined-space-entry.v02.json")
        with open(path, encoding="utf-8") as f:
            self.ENV = json.load(f)["environment"]
        self.rig("policy")
        self.call("request_approval", {"action": "open_door", "reason": "tank entry"})
        self.call("open_door")
        self.call("ventilate", {"seconds": 310})
        self.assertEqual(self.call("read_gas")["structuredContent"]["reason"], "gas_link_down")
        self.assertTrue(self.call("move_to", POINT_A)["isError"])
        self.assertFalse(self.sim.state.inside)

    def test_the_same_seed_and_calls_give_the_same_log(self):
        logs = []
        for _ in range(2):
            self.rig("policy")
            self.enter_safely()
            self.call("move_to", HOME)
            with open(os.path.join(self.dir.name, "gateway.jsonl"), encoding="utf-8") as f:
                logs.append(f.read())
        self.assertEqual(logs[0], logs[1])


if __name__ == "__main__":
    unittest.main()
