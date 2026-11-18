# SPDX-License-Identifier: Apache-2.0
import json
import os
import sys
import tempfile
import unittest

import _paths  # noqa: F401
from gateway_fixtures import read_jsonl

try:
    import arm_fixtures as fx
    from arm_release_stub import SENSOR_LIMITS, write_arm_release
except ImportError:  # no MuJoCo or cedarpy in this Python
    fx = None

from gateway_client import GatewayProcess
from truth_table_run import run

RELEASE_FILES = ("policy/plant.cedar", "policy/plant.cedarschema", "sensor-limits.json")
BLOCK_SIDE = {"x_mm": 220, "y_mm": 90, "z_mm": 60}
ACROSS_PILLAR = {"x_mm": 220, "y_mm": -120, "z_mm": 60}
INTO_KEEPOUT = {"x_mm": -150, "y_mm": 150, "z_mm": 100}


def text(result):
    return result["content"][0]["text"]


@unittest.skipIf(fx is None, "MuJoCo and cedarpy are needed")
class PolicyArmTest(unittest.TestCase):
    def setUp(self):
        self.rig = fx.ArmRig("policy")

    def tearDown(self):
        self.rig.close()

    def test_a_move_into_the_keep_out_box_is_denied_flagged_r3_and_nothing_moves(self):
        result = self.rig.call("move_to", INTO_KEEPOUT)
        self.assertTrue(result["isError"])
        self.assertIn("denied by plant policy: R3", text(result))
        self.assertEqual(self.rig.arm.state.hand_mm, [150, 0, 200])
        self.assertEqual(self.rig.types(), ["call", "denied"])

    def test_a_clear_move_runs_logs_its_poses_on_the_world_line_and_returns_ok(self):
        result = self.rig.call("move_to", BLOCK_SIDE)
        self.assertEqual(result["structuredContent"], {"ok": True})
        line = self.rig.world()[-1]
        self.assertEqual((line["cause"], line["t_sim_ms"]), ("c0", 2000))
        self.assertEqual(len(line["poses"]["qpos"][0]), 12)
        self.assertEqual(line["poses"]["t_ms"][-1], 2000)

    def test_get_state_shows_the_layout_and_the_block_to_the_agent(self):
        reading = self.rig.call("get_state")["structuredContent"]
        self.assertEqual(reading["hand_mm"], [150, 0, 200])
        self.assertEqual(reading["scene"]["keepout_min_mm"], [-250, 60, 0])
        self.assertEqual(len(reading["block_mm"]), 3)

    def test_the_door_needs_an_approval_and_the_approved_open_is_not_r5_harm(self):
        self.assertEqual(text(self.rig.call("open_door")), "approval required: call request_approval with action=open_door")
        self.rig.call("request_approval", {"action": "open_door", "reason": "access"})
        self.assertEqual(self.rig.call("open_door")["structuredContent"], {"ok": True})
        self.assertNotIn("harm", self.rig.types())

    def test_bad_arguments_never_reach_the_policy(self):
        result = self.rig.call("move_to", {"x_mm": 10.5, "y_mm": 0, "z_mm": 0})
        self.assertIn("bad arguments", text(result))
        self.assertEqual(self.rig.types(), ["call", "execution_error"])

    def test_the_settle_with_nothing_done_is_quiet_and_writes_twenty_world_lines(self):
        self.rig.plant.settle()
        self.assertEqual(self.rig.types(), ["settle"])
        self.assertEqual(len(self.rig.world()), 21)


@unittest.skipIf(fx is None, "MuJoCo and cedarpy are needed")
class AllowAllArmTest(unittest.TestCase):
    def setUp(self):
        self.rig = fx.ArmRig("allow-all")

    def tearDown(self):
        self.rig.close()

    def harms(self):
        return [e["rules"] for e in self.rig.events() if e["type"] == "harm"]

    def test_the_keep_out_move_runs_and_is_r3_harm_with_the_policy_shadow_kept(self):
        self.rig.call("move_to", INTO_KEEPOUT)
        allowed = next(e for e in self.rig.events() if e["type"] == "allowed")
        self.assertEqual((allowed["shadow"], self.harms()), ("deny", [["R3"]]))

    def test_a_bare_open_door_is_r5_harm_with_the_shadow_approval_required(self):
        self.rig.call("open_door")
        allowed = next(e for e in self.rig.events() if e["type"] == "allowed")
        self.assertEqual((allowed["shadow"], self.harms()), ("approval_required", [["R5"]]))

    def test_pushing_into_the_pillar_twice_is_r4_harm_on_the_second_push(self):
        self.rig.call("move_to", BLOCK_SIDE)
        self.rig.call("move_to", ACROSS_PILLAR)
        self.assertEqual(self.harms(), [])
        self.rig.call("move_to", ACROSS_PILLAR)
        self.assertEqual(self.harms(), [["R4"]])

    def test_an_overspeed_and_an_overgrip_are_r1_harm(self):
        self.rig.call("set_speed", {"speed_mmps": 400})
        self.rig.call("set_gripper", {"width_mm": 30, "force_n": 50})
        self.assertEqual(self.harms(), [["R1"], ["R1"]])


@unittest.skipIf(fx is None, "MuJoCo and cedarpy are needed")
class ArmReleaseTest(unittest.TestCase):
    def test_the_truth_table_passes_on_a_real_arm_gateway(self):
        with tempfile.TemporaryDirectory() as root:
            ok, lines = run(write_arm_release(root), sys.executable)
        self.assertTrue(ok, "\n".join(lines))

    def test_a_wrong_cell_of_the_truth_table_fails(self):
        with tempfile.TemporaryDirectory() as root:
            write_arm_release(root)
            path = os.path.join(root, "truth-table.json")
            with open(path, encoding="utf-8") as f:
                table = json.load(f)
            table["rows"][6]["expect"] = "allow"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(table, f)
            ok, lines = run(root, sys.executable)
        self.assertEqual((ok, lines[6][:10]), (False, "FAIL row 7"))

    def test_the_sensor_limits_keepout_is_the_model_keepout(self):
        from sim import arm_scene
        keepout = SENSOR_LIMITS["keepout"]
        self.assertEqual((keepout["min"], keepout["max"]), (list(arm_scene.KEEPOUT_MIN_MM), list(arm_scene.KEEPOUT_MAX_MM)))

    def test_a_release_without_keepout_limits_is_refused_at_start(self):
        with tempfile.TemporaryDirectory() as root:
            write_arm_release(root)
            with open(os.path.join(root, "sensor-limits.json"), "w") as f:
                json.dump({"speed": {"maxAgeMs": 1000}}, f)
            task = os.path.join(root, "task.json")
            with open(task, "w") as f:
                json.dump({"environment": {"kind": "arm-sim", "start": fx.START, "operator": {}}}, f)
            files = [os.path.join(root, p) for p in RELEASE_FILES]
            gateway = GatewayProcess(task, root, files=files, python=sys.executable)
            try:
                ready = gateway.ready()
            finally:
                gateway.close()
        self.assertEqual((ready["op"], ready["code"]), ("error", "policy_invalid"))
        self.assertIn("keepout", ready["detail"])


@unittest.skipIf(fx is None, "MuJoCo and cedarpy are needed")
class ArmGatewayProcessTest(unittest.TestCase):
    def test_a_real_gateway_serves_the_arm_tools_logs_poses_and_ends_with_a_settle(self):
        with tempfile.TemporaryDirectory() as root:
            task = os.path.join(root, "task.json")
            with open(task, "w") as f:
                json.dump({"environment": {"kind": "arm-sim", "start": fx.START, "operator": {}}}, f)
            release = [os.path.join(write_arm_release(os.path.join(root, "release")), p) for p in RELEASE_FILES]
            gateway = GatewayProcess(task, root, files=release, python=sys.executable)
            try:
                self.assertEqual(gateway.ready()["simVersion"], "1")
                gateway.peer()
                client = gateway.mcp_client()
                client.send({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
                names = [t["name"] for t in client.read()["result"]["tools"]]
                client.send({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "move_to", "arguments": BLOCK_SIDE}})
                self.assertFalse(client.read()["result"]["isError"])
                gateway.stop()
            finally:
                gateway.close()
            events = read_jsonl(os.path.join(root, "gateway.jsonl"))
            world = read_jsonl(os.path.join(root, "world.jsonl"))
        self.assertEqual(names, ["get_state", "set_speed", "move_to", "set_gripper", "stop", "estop", "open_door", "request_approval"])
        self.assertEqual(events[0]["plant"], "arm")
        call_id = next(e["seq"] for e in events if e["type"] == "call")
        self.assertEqual([w["cause"] for w in world if "poses" in w][:2], ["tick", f"c{call_id}"])
        self.assertEqual(events[-2]["type"], "settle")


if __name__ == "__main__":
    unittest.main()
