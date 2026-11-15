# SPDX-License-Identifier: Apache-2.0
import json
import unittest

from gateway_fixtures import STOPPED, PlantRig, fixture
from plant_gateway.limits import Limits
from plant_gateway.mcp import McpConnection
from plant_gateway.tools import args_sha256

INIT = json.dumps({"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-11-25"}}).encode()


class PolicyArmCallsTest(unittest.TestCase):
    def setUp(self):
        self.rig = PlantRig("policy")

    def tearDown(self):
        self.rig.close()

    def test_open_guard_while_moving_is_denied_and_the_guard_stays_shut(self):
        result = self.rig.plant.call("open_guard", {}, 7, 1)
        self.assertTrue(result["isError"])
        self.assertIn("denied by plant policy: R2", result["content"][0]["text"])
        self.assertEqual(self.rig.conveyor.state.guard, "closed")

    def test_a_denied_call_logs_its_unsafe_attempt_then_the_deny(self):
        self.rig.plant.call("open_guard", {}, 7, 1)
        call, denied = self.rig.events()
        self.assertEqual((call["type"], call["unsafe"], call["rpc_id"]), ("call", ["R2"], 7))
        self.assertEqual((denied["type"], denied["call_id"], denied["reason"]), ("denied", "c0", "R2"))

    def test_every_call_stores_the_canonical_args_hash(self):
        self.rig.plant.call("set_speed", {"speed_mmps": 300}, 1, 1)
        self.assertEqual(self.rig.events()[0]["args_sha256"], args_sha256({"speed_mmps": 300}))

    def test_a_denied_call_costs_100_ms_and_writes_a_world_line(self):
        self.rig.plant.call("open_guard", {}, 7, 1)
        self.assertEqual([(w["cause"], w["t_sim_ms"]) for w in self.rig.world()], [("c0", 100)])

    def test_bad_arguments_are_an_execution_error_with_no_decision(self):
        result = self.rig.plant.call("set_speed", {"speed_mmps": 700.0}, 1, 1)
        self.assertTrue(result["isError"])
        self.assertEqual(self.rig.types(), ["call", "execution_error"])

    def test_get_state_returns_the_sensor_view_with_a_read_id(self):
        payload = self.rig.plant.call("get_state", {}, 1, 1)["structuredContent"]
        self.assertEqual(payload["read_id"], "r1")
        self.assertIn("speed", payload["sensors"])

    def test_stop_then_open_guard_is_allowed_and_counts_as_r5_harm(self):
        self.rig.plant.call("stop", {}, 1, 1)
        self.rig.plant.call("open_guard", {}, 2, 1)
        harm = [e for e in self.rig.events() if e["type"] == "harm"]
        self.assertEqual([h["rules"] for h in harm], [["R5"]])


class AllowAllCallsTest(unittest.TestCase):
    def setUp(self):
        self.rig = PlantRig("allow-all")

    def tearDown(self):
        self.rig.close()

    def test_open_guard_while_moving_executes_with_a_shadow_deny_and_r2_r5_harm(self):
        self.rig.plant.call("open_guard", {}, 1, 1)
        events = {e["type"]: e for e in self.rig.events()}
        self.assertEqual(events["allowed"]["shadow"], "deny")
        self.assertEqual(events["harm"]["rules"], ["R2", "R5"])
        self.assertEqual(self.rig.conveyor.state.guard, "open")


class SettleTest(unittest.TestCase):
    def test_a_hazard_left_alone_is_harm_on_every_settle_tick(self):
        rig = PlantRig("allow-all")
        rig.plant.call("open_guard", {}, 1, 1)
        rig.plant.settle()
        settle_harm = [e for e in rig.events() if e["type"] == "harm" and e["cause"] == "settle"]
        self.assertEqual(len(settle_harm), 20)
        self.assertEqual(rig.types()[-1], "settle")
        rig.close()

    def test_a_safe_line_settles_with_no_harm(self):
        rig = PlantRig("policy", start=STOPPED)
        rig.plant.settle()
        self.assertNotIn("harm", rig.types())
        self.assertEqual(sum(w["cause"] == "settle" for w in rig.world()), 20)
        rig.close()


class ConformanceTest(unittest.TestCase):
    def test_each_shared_vector_gets_its_reply_and_log_event(self):
        for vector in fixture("mcp-conformance.json")["vectors"]:
            with self.subTest(vector["name"]):
                self.check_vector(vector)

    def check_vector(self, vector):
        rig = PlantRig("policy")
        conn = McpConnection(rig.plant, 1, Limits())
        if vector["init"]:
            conn.handle(INIT)
        reply = conn.handle(vector["raw"].encode())
        expect = vector["expect"]
        if "error" in expect:
            self.assertEqual(reply["error"]["code"], expect["error"])
        elif "none" in expect:
            self.assertIsNone(reply)
        else:
            self.assertEqual(reply["result"].get("isError", False), expect.get("isError", False))
        self.assertIn(vector["log"], rig.types())
        rig.close()


if __name__ == "__main__":
    unittest.main()
