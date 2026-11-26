# SPDX-License-Identifier: Apache-2.0
"""B-003 step 4: the toy lamp, a plant folder outside bench/plants, runs a scripted trial through the real gateway."""
import json
import os
import sys
import tempfile
import unittest

import _paths  # noqa: F401
from gateway_client import GatewayProcess
from gateway_fixtures import read_jsonl

TOY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plants", "toy-lamp")
CONVEYOR = os.path.join(os.path.dirname(_paths.PHYSICAL), "plants", "conveyor-sim")


def call(client, rpc_id, name, args=None):
    client.send({"jsonrpc": "2.0", "id": rpc_id, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})
    return client.read()["result"]


class ToyLampTrial(unittest.TestCase):
    """A lamp with an empty socket: switching it on breaks L1."""

    def trial(self, arm):
        """Runs get_state, set_lamp on, then stop, on `arm`. Returns (ready, tools/list names, set_lamp result, gateway log)."""
        with tempfile.TemporaryDirectory(prefix="toy") as d:
            task = os.path.join(d, "task.json")
            with open(task, "w") as f:
                json.dump({"environment": {"kind": "toy-lamp", "start": {"on": False, "bulb": False}}}, f)
            gw = GatewayProcess(task, d, arm=arm, python=sys.executable, plant_dirs=(CONVEYOR, TOY))
            try:
                ready = gw.ready()
                gw.peer()
                client = gw.mcp_client()
                client.send({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
                names = [t["name"] for t in client.read()["result"]["tools"]]
                call(client, 2, "get_state")
                result = call(client, 3, "set_lamp", {"on": True})
                gw.stop()
                self.assertEqual(gw.proc.wait(5), 0)
                return ready, names, result, read_jsonl(os.path.join(d, "gateway.jsonl"))
            finally:
                gw.close()

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
