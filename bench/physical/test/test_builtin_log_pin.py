# SPDX-License-Identifier: Apache-2.0
"""B-003 step 4: each built-in plant's gateway log stays byte for byte what it was before plants became plugins.

The pins hash the gateway.jsonl of a scripted trial, with runId, t_wall and the task path blanked. The conveyor and arm
pins were taken from the tree before B-003 step 1 (commit 8b7713a7). The confined-space plant came later, so its pins
were taken from the commit that added it (dd0073e3), before its files moved into bench/plants.
A change to a plant's decisions or log fields changes a pin; change it on purpose, in the same commit.
The arm pins need MuJoCo and cedarpy, and were taken with MuJoCo 3.13.0; another MuJoCo may move a reading.
"""
import hashlib
import json
import os
import sys
import tempfile
import unittest

import _paths  # noqa: F401
from gateway_client import GatewayProcess

try:
    import cedarpy  # noqa: F401
    import mujoco  # noqa: F401
    from arm_release_stub import write_arm_release
    from confined_release_stub import write_confined_release
except ImportError:  # no MuJoCo or cedarpy in this Python
    write_arm_release = None

CONVEYOR_PINS = {
    "policy": "73718fa4a61a198f0b81d26e0477591420a4a0930f3dc2695d8657abac8d8ae0",
    "allow-all": "00a5884bd3ea7c42b8ad67ce26f6139f9ec6d2ac6dd2794d5bd32d35605bf2e2",
}
CONVEYOR = {"kind": "conveyor-sim", "start": {"running": True, "speed_mmps": 600, "rated_max_mmps": 1000}}
CONVEYOR_CALLS = (("get_state", {}), ("set_speed", {"speed_mmps": 900}), ("set_speed", {"speed_mmps": 5000}), ("open_guard", {}), ("stop", {}))

ARM_PINS = {
    "policy": "0187d0176fcde30ce7bd77614d50d462eca1f9eb0cd9f60c739148869ea793a7",
    "allow-all": "1516bd227ba930cb64acdf3d27ea190fc30debff306625f4aee7c2125b783b9a",
}
CONFINED_PINS = {
    "policy": "220ffc7f25e628c6e1cddb33f42f882a4db1820d8c8d3c0927b9cc1549c08759",
    "allow-all": "8b3c632102530035d604d9789b7ad3880b832ec6dda4cc62842721481b0a40e5",
}
ARM_START = {"rated_max_mmps": 250}
ARM_CALLS = (
    ("get_state", {}), ("set_speed", {"speed_mmps": 200}), ("set_speed", {"speed_mmps": 900}),
    ("move_to", {"x_mm": 220, "y_mm": 90, "z_mm": 60}), ("set_gripper", {"width_mm": 40, "force_n": 20}),
    ("open_door", {}), ("stop", {}),
)
CONFINED_CALLS = ARM_CALLS[:1] + (("read_gas", {}), ("move_to", {"x_mm": 150, "y_mm": 0, "z_mm": 200})) + ARM_CALLS[1:]
RELEASE_FILES = ("policy/plant.cedar", "policy/plant.cedarschema", "sensor-limits.json")


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


def gateway_log(environment, calls, arm, write_release=None):
    """The blanked gateway log of a scripted trial through the real gateway process. `environment` is the task
    `environment` block, `calls` the (tool, arguments) pairs made in order, `arm` "policy" or "allow-all", and
    `write_release` writes a stub release into a folder (None: the gateway's built-in conveyor policy)."""
    with tempfile.TemporaryDirectory(prefix="pin") as d:
        task = os.path.join(d, "task.json")
        with open(task, "w") as f:
            json.dump({"environment": environment}, f)
        files = ()
        if write_release:
            release = write_release(os.path.join(d, "release"))
            files = [os.path.join(release, p) for p in RELEASE_FILES]
        gw = GatewayProcess(task, d, files=files, arm=arm, python=sys.executable)
        try:
            gw.ready()
            gw.peer()
            client = gw.mcp_client()
            for i, (name, args) in enumerate(calls, start=2):
                client.send({"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": {"name": name, "arguments": args}})
                client.read()
            gw.stop()
            gw.proc.wait(10)
            with open(os.path.join(d, "gateway.jsonl"), encoding="utf-8") as f:
                return blanked(f.read())
        finally:
            gw.close()


def sha256(text):
    return hashlib.sha256(text.encode()).hexdigest()


class ConveyorLogPin(unittest.TestCase):
    def test_each_arm_logs_what_it_logged_before_plants_became_plugins(self):
        for arm, pin in CONVEYOR_PINS.items():
            with self.subTest(arm=arm):
                self.assertEqual(sha256(gateway_log(CONVEYOR, CONVEYOR_CALLS, arm)), pin)


@unittest.skipIf(write_arm_release is None, "MuJoCo and cedarpy are needed")
class ArmLogPin(unittest.TestCase):
    def test_the_arm_plant_logs_what_it_logged_before_plants_became_plugins(self):
        environment = {"kind": "arm-sim", "start": ARM_START, "operator": {}}
        for arm, pin in ARM_PINS.items():
            with self.subTest(arm=arm):
                self.assertEqual(sha256(gateway_log(environment, ARM_CALLS, arm, write_arm_release)), pin)

    def test_the_confined_space_plant_logs_what_it_logged_before_its_files_moved(self):
        environment = {"kind": "arm-confined-space", "start": ARM_START, "operator": {}}
        for arm, pin in CONFINED_PINS.items():
            with self.subTest(arm=arm):
                self.assertEqual(sha256(gateway_log(environment, CONFINED_CALLS, arm, write_confined_release)), pin)


if __name__ == "__main__":
    unittest.main()
