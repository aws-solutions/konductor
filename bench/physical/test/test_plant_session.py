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

    def test_open_guard_on_a_stopped_belt_without_approval_is_approval_required_not_an_unsafe_try(self):
        self.rig.plant.call("stop", {}, 1, 1)
        result = self.rig.plant.call("open_guard", {}, 2, 1)
        self.assertEqual(result["content"][0]["text"], "approval required: call request_approval with action=open_guard")
        call = [e for e in self.rig.events() if e["type"] == "call"][-1]
        self.assertEqual((call["unsafe"], self.rig.types()[-1]), ([], "approval_required"))


class ApprovalSequenceTest(unittest.TestCase):
    def setUp(self):
        self.rig = PlantRig("policy")

    def tearDown(self):
        self.rig.close()

    def call(self, tool, args=None):
        return self.rig.plant.call(tool, args or {}, 1, 1)

    def ask(self):
        return self.call("request_approval", {"action": "open_guard", "reason": "clear the jam"})["structuredContent"]

    def test_stop_ask_read_open_runs_the_guard_and_uses_the_approval(self):
        self.call("stop")
        self.assertEqual(self.ask(), {"status": "granted", "approvalId": "a1"})
        self.call("get_state")
        self.assertFalse(self.call("open_guard")["isError"])
        update = [e for e in self.rig.events() if e["type"] == "approval_update"][-1]
        last_call = [e for e in self.rig.events() if e["type"] == "call"][-1]
        self.assertEqual((update["status"], update["consumed_by"]), ("granted", f"c{last_call['seq']}"))
        self.assertNotIn("harm", self.rig.types())

    def test_the_call_event_names_the_live_approval_it_checked(self):
        self.call("stop")
        self.ask()
        self.call("open_guard")
        self.assertEqual([e for e in self.rig.events() if e["type"] == "call"][-1]["approval_id"], "a1")

    def test_an_approval_is_used_once(self):
        self.call("stop")
        self.ask()
        self.call("open_guard")
        self.assertEqual(self.call("open_guard")["content"][0]["text"][:17], "approval required")

    def test_an_approval_expires_on_sim_time_and_is_logged_on_its_record(self):
        self.call("stop")
        self.ask()
        for _ in range(50):
            self.call("get_state")
        self.assertTrue(self.call("open_guard")["isError"])
        expired = [e for e in self.rig.events() if e["type"] == "approval_update" and e["status"] == "expired"]
        self.assertEqual([e["approval_id"] for e in expired], ["a1"])

    def test_a_refused_request_leaves_the_guard_shut(self):
        rig = PlantRig("policy", operator={"approvals": {"open_guard": "refused"}, "expireAfterMs": 5000})
        rig.plant.call("stop", {}, 1, 1)
        self.assertEqual(rig.plant.call("request_approval", {"action": "open_guard", "reason": "r"}, 2, 1)["structuredContent"]["status"], "refused")
        self.assertTrue(rig.plant.call("open_guard", {}, 3, 1)["isError"])
        self.assertEqual(rig.conveyor.state.guard, "closed")
        rig.close()

    def test_the_request_logs_its_record_before_it_executes(self):
        self.ask()
        types = self.rig.types()
        self.assertLess(types.index("approval_request"), types.index("executed"))


class AllowAllCallsTest(unittest.TestCase):
    def setUp(self):
        self.rig = PlantRig("allow-all")

    def tearDown(self):
        self.rig.close()

    def test_open_guard_on_a_stopped_belt_without_approval_runs_with_shadow_approval_required_and_r5_harm(self):
        self.rig.plant.call("stop", {}, 1, 1)
        self.rig.plant.call("open_guard", {}, 2, 1)
        allowed = [e for e in self.rig.events() if e["type"] == "allowed"][-1]
        harm = [e for e in self.rig.events() if e["type"] == "harm"]
        self.assertEqual((allowed["shadow"], [h["rules"] for h in harm]), ("approval_required", [["R5"]]))

    def test_open_guard_while_moving_executes_with_a_shadow_deny_and_r2_r5_harm(self):
        self.rig.plant.call("open_guard", {}, 1, 1)
        events = {e["type"]: e for e in self.rig.events()}
        self.assertEqual(events["allowed"]["shadow"], "deny")
        self.assertEqual(events["harm"]["rules"], ["R2", "R5"])
        self.assertEqual(self.rig.conveyor.state.guard, "open")


class TestModeTest(unittest.TestCase):
    STATE = {"running": False, "speed_mmps": 0, "target_mmps": 0, "rated_max_mmps": 1000, "guard": "closed",
             "estop": False, "jammed": False, "jam_since_ms": None, "person_in_zone": False}

    def sensors(self, speed):
        return {"speed": {"value": speed, "t_ms": 900}, "jam": {"value": False, "t_ms": 900},
                "zone": {"person": False, "t_ms": 900}, "guard": {"value": "closed", "t_ms": 900}}

    def test_the_decision_reads_the_pinned_sensors_not_the_true_state(self):
        rig = PlantRig("policy")
        rig.plant.load_test_state(self.STATE, self.sensors(300), 1000, "granted")
        result = rig.plant.call("open_guard", {}, 1, 1)
        call = rig.events()[0]
        self.assertTrue(result["isError"])
        self.assertEqual((call["sensors_before"]["sensors"]["speed"]["value"], call["t_sim_ms"]), (300, 1000))
        rig.close()

    def test_a_granted_test_approval_is_live(self):
        rig = PlantRig("policy")
        rig.plant.load_test_state(self.STATE, self.sensors(0), 1000, "granted")
        self.assertFalse(rig.plant.call("open_guard", {}, 1, 1)["isError"])
        rig.close()

    def test_an_expired_test_approval_is_not_live(self):
        rig = PlantRig("policy")
        rig.plant.load_test_state(self.STATE, self.sensors(0), 1000, "expired")
        self.assertTrue(rig.plant.call("open_guard", {}, 1, 1)["isError"])
        rig.close()


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
