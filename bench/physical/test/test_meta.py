# SPDX-License-Identifier: Apache-2.0
import json
import os
import tempfile
import unittest

import _paths  # noqa: F401
from plant_gateway.tools import tool_list
from sim import meta
from sim.conveyor import MOTION_TOOLS, TOOL_EFFECTS
from sim.rules import attempt_rules, procedure_harm


class MetaTest(unittest.TestCase):
    def test_an_unknown_major_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "meta.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"version": "plant-meta/2", "tools": [], "rules": {}}, f)
            with self.assertRaises(meta.MetaVersionError):
                meta.read_meta(path)

    def test_each_metadata_file_is_read_from_its_plant_folder(self):
        from sim.confined_space import CONFINED_META_PATH
        plants = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "plants")
        self.assertEqual(meta.PLANTS, plants)
        for path, kind in ((meta.META_PATH, "conveyor-sim"), (meta.ARM_META_PATH, "arm-sim"), (CONFINED_META_PATH, "arm-confined-space")):
            self.assertEqual(path, os.path.join(plants, kind, "meta.json"))

    def test_the_simulator_table_follows_the_metadata(self):
        self.assertEqual(list(TOOL_EFFECTS), list(meta.TOOLS))
        self.assertEqual({n: e.sim_ms for n, e in TOOL_EFFECTS.items()}, meta.SIM_MS)
        self.assertEqual(MOTION_TOOLS, meta.MOTION_TOOLS)

    def test_tools_list_offers_the_metadata_tools_in_order(self):
        self.assertEqual([t["name"] for t in tool_list()], list(meta.TOOLS))

    def test_attempt_rules_are_exactly_the_attempt_side_rules_and_r5_is_a_procedure_rule(self):
        self.assertEqual(meta.ATTEMPT_RULES, {"R1", "R2", "R3", "R4"})
        self.assertEqual(procedure_harm("open_guard", False), ["R5"])
        self.assertNotIn("R5", meta.ATTEMPT_RULES)
        self.assertEqual(meta.VERDICT_MEASURE["R5"], "end_to_end")

    def test_every_rule_attempt_rules_can_name_is_attempt_side(self):
        from sim.conveyor import TrueState
        state = TrueState(t_ms=0, running=True, speed_mmps=100, target_mmps=100, rated_max_mmps=1000, guard="open",
                          estop=False, jammed=True, jam_since_ms=0, person_in_zone=True)
        named = set(attempt_rules("set_speed", {"speed_mmps": 5000}, state, state))
        self.assertEqual(named, meta.ATTEMPT_RULES)


if __name__ == "__main__":
    unittest.main()
