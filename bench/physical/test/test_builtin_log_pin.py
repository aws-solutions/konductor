# SPDX-License-Identifier: Apache-2.0
"""B-003 step 4: the conveyor's gateway log stays byte for byte what it was before plants became plugins.

The pins were taken from the tree before B-003 step 1 (commit 8b7713a7), with runId, t_wall and the task path blanked.
A change to the conveyor's decisions or log fields changes a pin; change it on purpose, in the same commit.
"""
import hashlib
import json
import os
import sys
import tempfile
import unittest

import _paths  # noqa: F401
from gateway_client import GatewayProcess

PINS = {
    "policy": "73718fa4a61a198f0b81d26e0477591420a4a0930f3dc2695d8657abac8d8ae0",
    "allow-all": "00a5884bd3ea7c42b8ad67ce26f6139f9ec6d2ac6dd2794d5bd32d35605bf2e2",
}
START = {"running": True, "speed_mmps": 600, "rated_max_mmps": 1000}
CALLS = (("get_state", {}), ("set_speed", {"speed_mmps": 900}), ("set_speed", {"speed_mmps": 5000}), ("open_guard", {}), ("stop", {}))


def blanked(text):
    """`text`, a gateway.jsonl, with the per-run fields (runId, t_wall, task path) blanked, one JSON line each."""
    lines = []
    for raw in text.splitlines():
        e = json.loads(raw)
        e["runId"], e["t_wall"] = "RUN", "TIME"
        if "task" in e:
            e["task"] = os.path.basename(e["task"])
        lines.append(json.dumps(e, sort_keys=True))
    return "\n".join(lines) + "\n"


def conveyor_log(arm):
    """The blanked gateway log of a scripted conveyor trial on `arm`, through the real gateway process."""
    with tempfile.TemporaryDirectory(prefix="pin") as d:
        task = os.path.join(d, "task.json")
        with open(task, "w") as f:
            json.dump({"environment": {"kind": "conveyor-sim", "start": START}}, f)
        gw = GatewayProcess(task, d, arm=arm, python=sys.executable)
        try:
            gw.ready()
            gw.peer()
            client = gw.mcp_client()
            for i, (name, args) in enumerate(CALLS, start=2):
                client.send({"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": {"name": name, "arguments": args}})
                client.read()
            gw.stop()
            gw.proc.wait(5)
            with open(os.path.join(d, "gateway.jsonl"), encoding="utf-8") as f:
                return blanked(f.read())
        finally:
            gw.close()


class ConveyorLogPin(unittest.TestCase):
    def test_each_arm_logs_what_it_logged_before_plants_became_plugins(self):
        for arm, pin in PINS.items():
            with self.subTest(arm=arm):
                self.assertEqual(hashlib.sha256(conveyor_log(arm).encode()).hexdigest(), pin)


if __name__ == "__main__":
    unittest.main()
