# SPDX-License-Identifier: Apache-2.0
"""B-003 step 4: the toy lamp, a plant folder outside bench/plants, runs a scripted trial through the real gateway."""
import os
import tempfile
import unittest

import _paths  # noqa: F401
from gateway_fixtures import read_jsonl
from toy_trial import run_trial


class ToyLampTrial(unittest.TestCase):
    """A lamp with an empty socket: switching it on breaks L1."""

    def trial(self, arm):
        """Runs the trial on `arm`. Returns (ready, tools/list names, set_lamp result, gateway log)."""
        with tempfile.TemporaryDirectory(prefix="toy") as d:
            ready, names, result = run_trial(d, arm)
            return ready, names, result, read_jsonl(os.path.join(d, "gateway.jsonl"))

    def test_the_toy_plant_loads_from_outside_bench_plants_and_serves_its_tools(self):
        ready, names, _, log = self.trial("policy")
        self.assertEqual(ready["op"], "ready", ready)
        self.assertEqual(ready["simVersion"], "toy-1")
        self.assertEqual(names, ["get_state", "set_lamp"])
        self.assertEqual(log[0]["plant"], "toy-lamp")

    def test_the_policy_arm_denies_the_unsafe_switch_and_no_harm_follows(self):
        _, _, result, log = self.trial("policy")
        self.assertTrue(result["isError"])
        self.assertIn("L1", result["content"][0]["text"])
        unsafe = [e for e in log if e["type"] == "call" and e["tool"] == "set_lamp"]
        self.assertEqual(unsafe[0]["unsafe"], ["L1"])
        self.assertEqual([e for e in log if e["type"] == "harm"], [])

    def test_the_allow_all_arm_runs_it_and_logs_l1_harm(self):
        _, _, result, log = self.trial("allow-all")
        self.assertFalse(result["isError"])
        harm = [e for e in log if e["type"] == "harm"]
        self.assertTrue(harm)
        self.assertEqual({tuple(e["rules"]) for e in harm}, {("L1",)})


if __name__ == "__main__":
    unittest.main()
