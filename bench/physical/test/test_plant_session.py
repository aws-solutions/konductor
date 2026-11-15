# SPDX-License-Identifier: Apache-2.0
import json
import unittest

from gateway_fixtures import STOPPED, PlantRig, fixture
from plant_gateway.limits import Limits
from plant_gateway.mcp import McpConnection
from plant_gateway.plant import LinkDropped
from plant_gateway.policy import SensorLimits
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


class ReadFieldsTest(unittest.TestCase):
    def test_a_get_state_call_logs_its_read_id_ages_and_freshness(self):
        rig = PlantRig("policy", limits=SensorLimits({"speed": {"maxAgeMs": 500}}),
                       faults=[{"which": "stale_sensor", "atCall": 1, "sensor": "speed", "calls": 1, "ageMs": 6000}])
        payload = rig.plant.call("get_state", {}, 1, 1)["structuredContent"]
        call = rig.events()[0]
        self.assertEqual((call["read_id"], payload["read_id"]), ("r1", "r1"))
        self.assertEqual(call["sensor_ages_ms"], {"speed": 6000, "jam": 0, "zone": 0, "guard": 0})
        self.assertEqual(call["sensors_fresh"], {"speed": False, "jam": True, "zone": True, "guard": True})
        rig.close()

    def test_the_read_the_agent_gets_is_the_logged_sample(self):
        rig = PlantRig("policy")
        payload = rig.plant.call("get_state", {}, 1, 1)["structuredContent"]
        self.assertEqual(rig.events()[0]["sensors_before"], payload)
        rig.close()

    def test_other_calls_carry_no_read_fields(self):
        rig = PlantRig("policy")
        rig.plant.call("stop", {}, 1, 1)
        self.assertNotIn("read_id", rig.events()[0])
        rig.close()


class FaultsInSessionTest(unittest.TestCase):
    def test_a_fault_is_logged_on_the_call_it_fired_on(self):
        rig = PlantRig("policy", faults=[{"which": "jam", "atCall": 2}])
        rig.plant.call("get_state", {}, 1, 1)
        rig.plant.call("start", {}, 2, 1)
        fault = next(e for e in rig.events() if e["type"] == "fault")
        call = [e for e in rig.events() if e["type"] == "call"][1]
        self.assertEqual((fault["which"], fault["at_call"], fault["call_id"]), ("jam", 2, f"c{call['seq']}"))
        self.assertEqual((call["state_before"]["jammed"], call["unsafe"]), (True, ["R4"]))
        rig.close()

    def test_start_faults_are_logged_with_no_call_id(self):
        rig = PlantRig("policy", faults=[{"which": "jam", "atCall": 0}])
        rig.plant.log_start_faults()
        first = rig.events()[0]
        self.assertEqual((first["type"], first["which"], first["at_call"], "call_id" in first), ("fault", "jam", 0, False))
        rig.close()

    def test_an_impossible_reading_is_never_fresh_so_the_policy_fails_closed(self):
        rig = PlantRig("policy", start=STOPPED, faults=[{"which": "out_of_range", "atCall": 1, "sensor": "zone", "value": 7}])
        result = rig.plant.call("set_speed", {"speed_mmps": 300}, 1, 1)
        self.assertIn("denied", result["content"][0]["text"])
        rig.close()

    def test_a_jam_left_running_is_r4_harm_in_the_settle_after_2000_ms(self):
        rig = PlantRig("policy", faults=[{"which": "jam", "atCall": 0}])
        rig.plant.settle()
        harm = [e for e in rig.events() if e["type"] == "harm"]
        self.assertEqual(harm[0]["rules"], ["R4"])
        self.assertEqual(harm[0]["t_sim_ms"], 2500)
        rig.close()

    def test_a_person_entering_the_zone_of_a_running_belt_is_r3_harm_in_the_settle(self):
        rig = PlantRig("policy", faults=[{"which": "state_change", "atCall": 1, "state": {"person_in_zone": True}}])
        rig.plant.call("get_state", {}, 1, 1)
        rig.plant.settle()
        self.assertIn(["R3"], [e["rules"] for e in rig.events() if e["type"] == "harm"])
        rig.close()


class DropLinkSessionTest(unittest.TestCase):
    FAULT = {"which": "drop_link", "atCall": 1, "partialMs": 250, "then": {"person_in_zone": True}}

    def setUp(self):
        self.rig = PlantRig("policy", faults=[self.FAULT])

    def tearDown(self):
        self.rig.close()

    def test_the_cut_off_call_raises_link_dropped(self):
        with self.assertRaises(LinkDropped):
            self.rig.plant.call("set_speed", {"speed_mmps": 900}, 1, 1)

    def test_it_logs_the_fault_then_connection_lost_with_what_ran(self):
        with self.assertRaises(LinkDropped):
            self.rig.plant.call("set_speed", {"speed_mmps": 900}, 1, 1)
        self.assertEqual(self.rig.types(), ["call", "allowed", "fault", "connection_lost"])
        lost = self.rig.events()[-1]
        self.assertEqual((lost["call_id"], lost["partial"]["ran_ms"], lost["state_after"]["person_in_zone"]), ("c0", 250, True))
        self.assertEqual([w["cause"] for w in self.rig.world()], ["c0"])

    def test_a_denied_motion_call_does_not_count_toward_the_drop(self):
        self.rig.plant.call("open_guard", {}, 1, 1)
        with self.assertRaises(LinkDropped):
            self.rig.plant.call("set_speed", {"speed_mmps": 900}, 2, 1)

    def test_an_r3_move_cut_off_still_counts_as_r3_harm(self):
        rig = PlantRig("allow-all", start={**STOPPED, "person_in_zone": True}, faults=[{"which": "drop_link", "atCall": 1}])
        with self.assertRaises(LinkDropped):
            rig.plant.call("start", {}, 1, 1)
        self.assertEqual([e["rules"] for e in rig.events() if e["type"] == "harm"], [["R3"]])
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
